import type { Page } from "@playwright/test";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  hexToString,
  isHex,
  type Hex,
  type TypedDataDomain,
} from "viem";

/**
 * Phase 4d (2026-05-16) — deterministic mock-injected `window.ethereum`.
 *
 * Replaces the synpress + real-MetaMask harness with a deterministic
 * EIP-1193 provider backed by a viem `PrivateKeyAccount`. The React app
 * sees a normal `window.ethereum`; wagmi's `injected()` connector picks
 * it up without modification.
 *
 * Architecture:
 *   - Node side: PrivateKeyAccount handles ALL signing (personal_sign,
 *     eth_signTypedData_v4). Real cryptography — these signatures verify
 *     on-chain identically to MetaMask's output.
 *   - Browser side: a tiny shim at `window.ethereum` proxies `request()`
 *     calls back to Node via Playwright's `exposeFunction` bridge.
 *   - RPC reads (eth_chainId / eth_call / eth_blockNumber / eth_getBalance
 *     etc.) are forwarded from the shim to Node, which proxies to the
 *     real Alchemy RPC. Keeps balance/code reads accurate during tests.
 *
 * What this catches (the bug class that broke Phase 4c):
 *   - React wiring: Header showing EOA vs TW, WithdrawModal pre-fill,
 *     CancelOrderButton signing path. All exercised exactly as in prod.
 *   - Atom propagation: userSmartAccount, apiConfig, balanceSnapshot
 *     side-effects through the full React lifecycle.
 *   - Backend integration: /thin-wallet/provision, /thin-wallet/execute-
 *     with-sig, /orders sign-path acceptance.
 *
 * What it does NOT catch:
 *   - MetaMask's own UX (popup copy, connector enumeration, network-add
 *     prompts). We don't own that code path.
 *
 * Usage:
 *   const wallet = await installMockWallet(page, { rpcUrl, chainId });
 *   await page.goto(BASE);
 *   // wagmi auto-detects window.ethereum, app behaves as if MetaMask
 *   // is installed and unlocked at address `wallet.address`.
 */

export interface MockWalletOpts {
  /** Optional pre-set private key. If omitted, a fresh random key is
   *  generated — preferred for test isolation (no shared on-chain state
   *  between runs). */
  privateKey?: Hex;
  /** Numeric chain ID this wallet pretends to be on. Default 421614 (Arb Sepolia). */
  chainId?: number;
  /** RPC URL to forward read calls to. Default Alchemy Sepolia. */
  rpcUrl?: string;
}

export interface InstalledMockWallet {
  account: PrivateKeyAccount;
  address: `0x${string}`;
  privateKey: Hex;
}

export async function installMockWallet(
  page: Page,
  opts: MockWalletOpts = {},
): Promise<InstalledMockWallet> {
  const privateKey = (opts.privateKey ?? generatePrivateKey()) as Hex;
  const account = privateKeyToAccount(privateKey);
  const chainId = opts.chainId ?? 421614;
  const chainIdHex = `0x${chainId.toString(16)}`;
  const rpcUrl =
    opts.rpcUrl ?? "https://arb-sepolia.g.alchemy.com/v2/m1ZDZF0NDLbqkK-we12g0";

  // ── Node-side signing bridge ────────────────────────────────────
  await page.exposeFunction(
    "__mockSign",
    async (method: string, params: unknown[]): Promise<string> => {
      if (method === "personal_sign") {
        const [hexMsg] = params as [Hex, string];
        if (!isHex(hexMsg)) {
          // wagmi sometimes passes utf8 directly; fall back to string treatment.
          return await account.signMessage({ message: hexMsg as unknown as string });
        }
        // viem expects raw bytes; pass-through the hex preserves exact MetaMask semantics.
        const asUtf8 = (() => {
          try {
            return hexToString(hexMsg);
          } catch {
            return null;
          }
        })();
        if (asUtf8 !== null && !/[\x00-\x08\x0e-\x1f\x7f]/.test(asUtf8)) {
          return await account.signMessage({ message: asUtf8 });
        }
        return await account.signMessage({ message: { raw: hexMsg } });
      }
      if (method === "eth_signTypedData_v4" || method === "eth_signTypedData") {
        const [, typedDataJson] = params as [string, string];
        const td = JSON.parse(typedDataJson) as {
          domain: TypedDataDomain;
          types: Record<string, Array<{ name: string; type: string }>>;
          primaryType: string;
          message: Record<string, unknown>;
        };
        // viem requires `EIP712Domain` absent from the types map it accepts.
        const types: Record<string, Array<{ name: string; type: string }>> = {};
        for (const k of Object.keys(td.types)) {
          if (k !== "EIP712Domain") types[k] = td.types[k]!;
        }
        return await account.signTypedData({
          domain: td.domain,
          types,
          primaryType: td.primaryType,
          message: td.message,
        });
      }
      throw new Error(`mockWallet: unsupported sign method ${method}`);
    },
  );

  // ── Node-side RPC proxy ─────────────────────────────────────────
  await page.exposeFunction(
    "__mockRpcProxy",
    async (method: string, params: unknown): Promise<unknown> => {
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? `rpc error on ${method}`);
      return j.result;
    },
  );

  // ── Browser-side injection ──────────────────────────────────────
  // Runs BEFORE any other script on the page (per Playwright addInitScript
  // contract). wagmi's `injected()` then discovers our shim during its
  // boot-time provider probing.
  await page.addInitScript(
    ({ address, chainIdHex, decChainId }) => {
      type Listener = (...args: unknown[]) => void;
      const listeners: Record<string, Listener[]> = {};

      const emit = (event: string, ...args: unknown[]) => {
        (listeners[event] ?? []).slice().forEach((h) => {
          try {
            h(...args);
          } catch {
            /* swallow */
          }
        });
      };

      const provider = {
        isMetaMask: true,
        _isMockWallet: true,
        selectedAddress: address,
        chainId: chainIdHex,
        networkVersion: String(decChainId),

        isConnected() {
          return true;
        },

        async request({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }): Promise<unknown> {
          if (method === "eth_chainId") return chainIdHex;
          if (method === "net_version") return String(decChainId);
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [address];
          }
          if (
            method === "personal_sign" ||
            method === "eth_signTypedData_v4" ||
            method === "eth_signTypedData"
          ) {
            // @ts-expect-error injected by exposeFunction
            return await window.__mockSign(method, params ?? []);
          }
          if (
            method === "wallet_switchEthereumChain" ||
            method === "wallet_addEthereumChain" ||
            method === "wallet_requestPermissions" ||
            method === "wallet_revokePermissions"
          ) {
            return null;
          }
          if (method === "eth_sendTransaction") {
            throw new Error(
              "mockWallet: eth_sendTransaction is not supported — Phase 4 flows go through the relayer (executeWithSig). If a test path triggers this, the app is bypassing the meta-tx flow.",
            );
          }
          // RPC reads — forward to Alchemy via Node proxy.
          // @ts-expect-error injected by exposeFunction
          return await window.__mockRpcProxy(method, params ?? []);
        },

        on(event: string, handler: Listener) {
          (listeners[event] ??= []).push(handler);
        },
        removeListener(event: string, handler: Listener) {
          const arr = listeners[event] ?? [];
          const i = arr.indexOf(handler);
          if (i >= 0) arr.splice(i, 1);
        },
      };

      // Install on both legacy windows.ethereum AND EIP-6963 discovery channel.
      Object.defineProperty(window, "ethereum", {
        value: provider,
        writable: false,
        configurable: true,
      });

      // EIP-6963: announce the provider so modern wagmi discovery picks it up.
      window.addEventListener("eip6963:requestProvider", () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "00000000-0000-4000-8000-000000000001",
                name: "MockWallet",
                icon: "data:image/svg+xml;base64,",
                rdns: "io.pulsepairs.mockwallet",
              },
              provider,
            },
          }),
        );
      });

      // Best-effort ready emit so any listener attached during boot fires.
      setTimeout(() => emit("connect", { chainId: chainIdHex }), 0);
    },
    { address: account.address, chainIdHex, decChainId: chainId },
  );

  return { account, address: account.address, privateKey };
}

// ── Local helper: keep the dependency surface lean (no @noble/* etc.) ──

function generatePrivateKey(): Hex {
  const bytes = new Uint8Array(32);
  // crypto.getRandomValues is universally available in Node 18+ and the browser.
  globalThis.crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}
