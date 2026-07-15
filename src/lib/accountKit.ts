"use client";

/**
 * Alchemy Account Kit (smart-contract account, "SCA") custody for UpDown.
 *
 * Replaces the Phase-4 ThinWallet: the user's trading identity is now an
 * Alchemy SCA derived deterministically from their owner EOA — the SAME
 * config rain.trade's `RainAA` uses (same chain + alchemyApiKey [+ policy]),
 * so the same owner EOA resolves to the same SCA across both products.
 *
 * This is a vendored copy of `@updown/sdk`'s `UpDownAccountKitSigner`
 * (sdk/typescript/src/accountKit.ts), minus the SDK's ws-auth helper (the FE
 * builds WsAuth typed-data in `lib/wsAuth.ts`) — keep the two in sync until
 * the package is published and this file becomes an import.
 *
 * The two hard rules (UPDOWN_SATELLITE_CHANGE_DESIGN.md §2):
 *   1. Orders/cancels MUST be bare ERC-1271 (6492 wrapper stripped) — the
 *      on-chain OZ SignatureChecker cannot parse 6492 blobs.
 *   2. The SCA MUST be deployed before its first fill (`onboard()` = one
 *      UserOp: deploy + approve settlement).
 * WS-auth is the one place the RAW (possibly 6492-wrapped) signature is used
 * on purpose: the backend verifies off-chain with viem `verifyTypedData`,
 * which validates counterfactual 6492 sigs — so private channels work even
 * before the SCA is deployed. Nothing on-chain ever sees that signature.
 *
 * Gas modes (config-driven, see `createUpDownAccountKitSigner`):
 *   - no policyId          → SELF-PAID UserOps (SCA must hold a little ETH;
 *                            the dev faucet seeds it). Demo default.
 *   - policyId only        → app-sponsored (sponsorship-type policy).
 *   - policyId + gasToken  → user pays gas in that token (ERC-20-type
 *                            policy; the current `fed14eaa…` policy is this
 *                            type with USDC allowed).
 *
 * Session-key order signing (2026-07-06, PoC-validated on-chain + live API —
 * see updown-demo/POC_SESSION_KEY_ORDERS_2026-07-06.md):
 *   A locally-generated session key is installed on the MA-v2 SCA as a
 *   SingleSignerValidationModule entity with `isSignatureValidation: true`
 *   and `isUserOpValidation: false` — it can ONLY answer ERC-1271
 *   `isValidSignature` (orders / cancels / WS-auth); it can never execute a
 *   UserOp (no withdrawals, no transfers). The install rides the onboarding
 *   UserOp for fresh users (still exactly ONE wallet popup ever) or a
 *   one-time UserOp for already-onboarded SCAs; afterwards all order signing
 *   is popup-less. NOTE this is NOT rain.trade's `grantPermissions` session
 *   (that mechanism authorizes UserOp execution only and its signatures pack
 *   the owner entity — verified incapable of 1271 order signing).
 *   The key + entityId live in localStorage (`updown:oskey:<sca>`) with a
 *   24h client-side expiry — same browser-custody trust class as rain.trade's
 *   IndexedDB session keys, but with a strictly narrower blast radius.
 *   Expiry is NOT enforced on-chain, and cannot be with the stock modules:
 *   TimeRangeModule's `preSignatureValidationHook` is declared `pure` (it
 *   cannot read `block.timestamp`) and reverts NotImplemented, so it gates
 *   UserOps and runtime calls only — i.e. everything EXCEPT the one path this
 *   entity has. Clock-authoritative expiry has to come from the backend, which
 *   already verifies every order signature. Locally, `revokeOrderSession()` and
 *   `disconnect()` both drop the key; neither uninstalls the entity on-chain,
 *   so an already-exfiltrated key stays valid until the entity is uninstalled
 *   (owner-signed UserOp — production follow-up).
 *   Kill switch: NEXT_PUBLIC_SESSION_ORDERS=0 → owner-key popup per order
 *   (the pre-2026-07-06 behavior). Any session failure at runtime also falls
 *   back to the owner path automatically.
 */
import {
  decodeAbiParameters,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
} from "viem";
import { activeChain, ALCHEMY_API_KEY, ALCHEMY_RPC_URL } from "@/config/environment";

/* ───────────────────────── EIP-6492 unwrap ───────────────────────── */

const ERC6492_MAGIC =
  "6492649264926492649264926492649264926492649264926492649264926492";

export function isErc6492Signature(signature: Hex): boolean {
  return signature.length >= 66 && signature.slice(-64).toLowerCase() === ERC6492_MAGIC;
}

/** Return the BARE inner signature from an EIP-6492-wrapped blob, or the
 *  input unchanged if not wrapped. */
export function stripErc6492Wrapper(signature: Hex): Hex {
  if (!isErc6492Signature(signature)) return signature;
  const body = ("0x" + signature.slice(2, signature.length - 64)) as Hex;
  const [, , inner] = decodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
    body,
  ) as [Address, Hex, Hex];
  return inner;
}

/* ───────────────────────── The signer class ───────────────────────── */

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

export type UpDownAccountKitConfig = {
  walletClient: Eip1193Provider;
  alchemyApiKey: string;
  paymasterPolicyId?: string;
  gasToken?: { tokenAddress: Address };
  /**
   * Sponsored-transfer billing (see lib/gasFee.ts). When set alongside
   * `paymasterPolicyId` (and WITHOUT `gasToken`), every UserOp batches a
   * `transfer(collector, gasCostInFeeToken)` so the sponsored gas is recovered
   * in the collateral token. Unset → sponsorship is free to the user.
   */
  gasFeeCollector?: Address;
  /** Token the sponsored-transfer fee is charged in (the demo's USDTm). */
  feeToken?: Address;
  chain: Chain;
  rpcUrl?: string;
};

/** Shared SCA-address cache key (identical to rain.trade's `useRain`). */
function saCacheKey(eoa: string): string {
  return `rain:sa:${eoa.toLowerCase()}`;
}

function writeCachedSA(eoa: string, addr: string): void {
  try {
    localStorage.setItem(saCacheKey(eoa), addr);
  } catch {
    /* private mode / SSR — best effort */
  }
}

/**
 * Read the cached (deterministic, counterfactual) SCA address for an owner EOA.
 * The SCA is a pure function of the EOA, so on reload we can hydrate it
 * synchronously — before the cold `connect()` RPC returns — so the UI never
 * flashes a disconnected state. `connect()` still runs and overwrites the cache
 * with the authoritative address. (Same contract as rain.trade's `useRain`.)
 */
export function readCachedSA(eoa: string): string | null {
  try {
    const v = localStorage.getItem(saCacheKey(eoa));
    return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/* ───────────────────── order-session (session key) storage ───────────────────── */

const SESSION_TTL_SEC = 24 * 60 * 60;

export type OrderSessionRecord = {
  v: 1;
  /** Session private key — browser custody, same trust class as rain.trade's session keys. */
  privateKey: Hex;
  /** MA-v2 validation entity id the key is installed under on the SCA. */
  entityId: number;
  /** Unix sec the key was generated. Absent on records written before 2026-07-14. */
  createdSec?: number;
  /** Client-side expiry (unix sec). NOT enforced on-chain — see header. */
  expirySec: number;
};

/**
 * The record lives in plain localStorage, so `expirySec` is attacker-writable —
 * anything with disk or XSS access can post-date it and keep the entity alive
 * indefinitely. Anchor the TTL to `createdSec` and clamp `createdSec` to now, so
 * the honoured expiry is never more than SESSION_TTL_SEC out no matter what the
 * file says. Honest bound: this does nothing against an attacker who has already
 * copied the key (they have it), but it makes SESSION_TTL_SEC a real ceiling
 * rather than a value we ask the disk to respect.
 */
export function effectiveExpirySec(rec: OrderSessionRecord, nowSec: number): number {
  const anchored = Math.min(rec.createdSec ?? nowSec, nowSec) + SESSION_TTL_SEC;
  return Math.min(rec.expirySec, anchored);
}

export function sessionOrdersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SESSION_ORDERS?.trim() !== "0";
}

function orderSessionKey(sca: string): string {
  return `updown:oskey:${sca.toLowerCase()}`;
}

export function readOrderSession(sca: string): OrderSessionRecord | null {
  try {
    const raw = localStorage.getItem(orderSessionKey(sca));
    if (!raw) return null;
    const rec = JSON.parse(raw) as OrderSessionRecord;
    if (rec?.v !== 1 || typeof rec.privateKey !== "string" || !rec.entityId) return null;
    const now = Math.floor(Date.now() / 1000);
    if (effectiveExpirySec(rec, now) <= now) {
      localStorage.removeItem(orderSessionKey(sca));
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

function writeOrderSession(sca: string, rec: OrderSessionRecord): void {
  try {
    localStorage.setItem(orderSessionKey(sca), JSON.stringify(rec));
  } catch {
    /* private mode — session won't survive reload; signing still works this tab */
  }
}

export class UpDownAccountKitSigner {
  private readonly config: UpDownAccountKitConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _account: any = null;
  private _address: Address | null = null;
  private _ownerEoa: Address | null = null;
  private _session: OrderSessionRecord | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sessionClient: any = null;

  constructor(config: UpDownAccountKitConfig) {
    if (!config.walletClient) throw new Error("walletClient (owner EIP-1193 provider) is required");
    if (!config.alchemyApiKey) throw new Error("alchemyApiKey is required");
    if (!config.chain) throw new Error("chain is required");
    this.config = config;
  }

  /** Create the owner smart-wallet client and resolve the SCA address. */
  async connect(): Promise<Address> {
    if (this._address && this._client) return this._address;

    const [aaCore, infraMod, walletClientLib] = await Promise.all([
      import("@aa-sdk/core"),
      import("@account-kit/infra"),
      import("@account-kit/wallet-client"),
    ]);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { WalletClientSigner } = aaCore as any;
    const { alchemy, defineAlchemyChain } = infraMod as any;
    const { createSmartWalletClient } = walletClientLib as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const { createWalletClient, custom } = await import("viem");

    const alchemyChain = defineAlchemyChain({
      chain: this.config.chain,
      rpcBaseUrl: `https://${this.config.chain.id === 42161 ? "arb-mainnet" : "arb-sepolia"}.g.alchemy.com/v2`,
    });

    const eoaSigner = new WalletClientSigner(
      createWalletClient({ transport: custom(this.config.walletClient) }),
      "wallet",
    );

    const eoaClient = createSmartWalletClient({
      chain: alchemyChain,
      signer: eoaSigner,
      ...(this.config.paymasterPolicyId ? { policyId: this.config.paymasterPolicyId } : {}),
      transport: alchemy({ apiKey: this.config.alchemyApiKey, nodeRpcUrl: this.config.rpcUrl }),
    });

    const account = await eoaClient.requestAccount();
    if (!account?.address) throw new Error("Failed to resolve Alchemy smart account");

    this._client = eoaClient;
    this._account = account;
    this._address = account.address as Address;
    this._ownerEoa = (await eoaSigner.getAddress()) as Address;
    writeCachedSA(this._ownerEoa, this._address);
    return this._address;
  }

  /** The SCA address — `order.maker`, the deposit address, the ERC-1271 signer. */
  get address(): Address {
    if (!this._address) throw new Error("Not connected. Call connect() first.");
    return this._address;
  }

  get ownerEoa(): Address {
    if (!this._ownerEoa) throw new Error("Not connected. Call connect() first.");
    return this._ownerEoa;
  }

  /**
   * EIP-712 typed data for OFF-CHAIN verifiers (WS-auth): session-key signed
   * (popup-less, bare — the SCA is deployed whenever a session exists) when a
   * session is active, else owner-signed RAW — possibly 6492-wrapped when the
   * SCA is not yet deployed. The backend's viem `verifyTypedData` accepts
   * both. Never for orders (use `signTypedDataBare`).
   */
  async signTypedDataRaw(typedData: TypedDataDefinition): Promise<Hex> {
    const session = await this.sessionSign(typedData);
    if (session) return session;
    return this.signTypedDataOwnerRaw(typedData);
  }

  /**
   * EIP-712 typed data as a BARE ERC-1271 signature — the ONLY signing path
   * for orders and cancels. Session-key signed (popup-less) when a session is
   * active; owner-signed with the 6492 wrapper stripped otherwise. The SCA
   * must be deployed (`onboard`) before the signature is used in a fill.
   */
  async signTypedDataBare(typedData: TypedDataDefinition): Promise<Hex> {
    const session = await this.sessionSign(typedData);
    if (session) return session;
    return stripErc6492Wrapper(await this.signTypedDataOwnerRaw(typedData));
  }

  /** The owner smart-wallet-client signature (MetaMask popup). */
  private async signTypedDataOwnerRaw(typedData: TypedDataDefinition): Promise<Hex> {
    if (!this._client || !this._address) throw new Error("Not connected. Call connect() first.");
    return (await this._client.signTypedData({
      ...typedData,
      account: this._address,
    })) as Hex;
  }

  /* ─────────────── session-key signing (see header block) ─────────────── */

  /** True iff an unexpired order session exists for the connected SCA. */
  get hasOrderSession(): boolean {
    if (!sessionOrdersEnabled() || !this._address) return false;
    return !!(this._session ?? readOrderSession(this._address));
  }

  /**
   * Sign typed data with the session key (MA-v2 entity signature, bare by
   * construction — the packed entity locator + ERC-7739 wrap validate
   * on-chain via `isValidSignature`). Returns null when no session is active
   * or anything fails — callers fall back to the owner path.
   */
  private async sessionSign(typedData: TypedDataDefinition): Promise<Hex | null> {
    try {
      const account = await this.sessionAccount();
      if (!account) return null;
      return (await account.signTypedData(typedData)) as Hex;
    } catch (e) {
      console.warn("[accountKit] session signing failed — falling back to owner key", e);
      this._sessionClient = null; // rebuild lazily; a stale client shouldn't wedge signing
      return null;
    }
  }

  /** Lazily build the MA-v2 client bound to the session key's entity. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sessionAccount(): Promise<any | null> {
    if (!sessionOrdersEnabled() || !this._address) return null;
    const rec = this._session ?? readOrderSession(this._address);
    if (!rec) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    // Re-checked here (not just in readOrderSession) because `this._session` is
    // an in-memory cache that never re-reads the disk — a long-lived tab must
    // still age out.
    if (effectiveExpirySec(rec, nowSec) <= nowSec) {
      this.revokeOrderSession();
      return null;
    }
    this._session = rec;
    if (!this._sessionClient) {
      const [aaCore, scMod, infraMod] = await Promise.all([
        import("@aa-sdk/core"),
        import("@account-kit/smart-contracts"),
        import("@account-kit/infra"),
      ]);
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { LocalAccountSigner } = aaCore as any;
      const { createModularAccountV2Client } = scMod as any;
      const { alchemy } = infraMod as any;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      this._sessionClient = await createModularAccountV2Client({
        mode: "default",
        chain: await this.infraChain(),
        transport: alchemy({ apiKey: this.config.alchemyApiKey }),
        signer: LocalAccountSigner.privateKeyToAccountSigner(this._session.privateKey),
        accountAddress: this._address,
        signerEntity: { entityId: this._session.entityId, isGlobalValidation: false },
      });
    }
    return this._sessionClient.account;
  }

  /**
   * Make sure an order session exists: no-op when one is active (or the
   * feature is off), otherwise install a fresh session key via a one-time
   * owner UserOp (one popup — fresh users get it batched into `onboard()`
   * instead and never hit this path). Throws if the user rejects; callers
   * treat that as non-fatal and keep owner-key signing.
   */
  async ensureOrderSession(): Promise<"disabled" | "active" | "installed"> {
    if (!sessionOrdersEnabled()) return "disabled";
    if (!this._client || !this._address) throw new Error("Not connected. Call connect() first.");
    if (await this.sessionAccount()) return "active";
    const { call, record } = await this.buildSessionInstallCall();
    await this.sendCalls([call]);
    this.persistOrderSession(record);
    return "installed";
  }

  /** Drop the local session key (no on-chain uninstall — demo scope). */
  revokeOrderSession(): void {
    if (this._address) {
      try {
        localStorage.removeItem(orderSessionKey(this._address));
      } catch {
        /* best effort */
      }
    }
    this._session = null;
    this._sessionClient = null;
  }

  private persistOrderSession(record: OrderSessionRecord): void {
    if (!this._address) return;
    writeOrderSession(this._address, record);
    this._session = record;
    this._sessionClient = null; // built lazily on first sign
  }

  /**
   * Build the `installValidation` self-call that registers a fresh session
   * key on the SCA as a signature-validation-ONLY entity (validated flow:
   * scripts/poc-session-key-fe-flow.mjs).
   */
  private async buildSessionInstallCall(): Promise<{
    call: { to: Address; data: Hex };
    record: OrderSessionRecord;
  }> {
    const [viemAccounts, expMod, viem] = await Promise.all([
      import("viem/accounts"),
      import("@account-kit/smart-contracts/experimental"),
      import("viem"),
    ]);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { generatePrivateKey, privateKeyToAccount } = viemAccounts as any;
    const {
      getDefaultSingleSignerValidationModuleAddress,
      SingleSignerValidationModule,
      serializeValidationConfig,
      semiModularAccountBytecodeAbi,
    } = expMod as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const privateKey = generatePrivateKey() as Hex;
    const sessionAddress = privateKeyToAccount(privateKey).address as Address;
    const nowSec = Math.floor(Date.now() / 1000);
    // Random 4-byte entity id (≥2): 0 is the owner entity, and installing an
    // id that already exists on the account reverts — random keeps collisions
    // with prior sessions (lost storage, other browsers) vanishingly unlikely.
    const entityId = 2 + Math.floor(Math.random() * 0x7ffffff0);
    const data = viem.encodeFunctionData({
      abi: semiModularAccountBytecodeAbi,
      functionName: "installValidation",
      args: [
        serializeValidationConfig({
          moduleAddress: getDefaultSingleSignerValidationModuleAddress(await this.infraChain()),
          entityId,
          isGlobal: false,
          isSignatureValidation: true, // can answer ERC-1271…
          isUserOpValidation: false, // …but can never execute a UserOp
        }),
        [],
        SingleSignerValidationModule.encodeOnInstallData({ entityId, signer: sessionAddress }),
        [],
      ],
    }) as Hex;
    return {
      call: { to: this.address, data },
      record: {
        v: 1,
        privateKey,
        entityId,
        createdSec: nowSec,
        expirySec: nowSec + SESSION_TTL_SEC,
      },
    };
  }

  /** The @account-kit/infra chain (Alchemy RPC config baked in) for MA-v2 clients. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async infraChain(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const infra = (await import("@account-kit/infra")) as any;
    return this.config.chain.id === 421614 ? infra.arbitrumSepolia : infra.arbitrum;
  }

  /** True iff the SCA has bytecode on-chain (deploy-before-fill precondition). */
  async isDeployed(publicClient: PublicClient): Promise<boolean> {
    if (!this._address) throw new Error("Not connected. Call connect() first.");
    const code = await publicClient.getBytecode({ address: this._address });
    return !!code && code !== "0x";
  }

  /**
   * One-time onboarding: DEPLOY the SCA, `approve(settlement, USDT, amount)` AND
   * install the order-session key, all in a single UserOp (deployment rides
   * the account init-code) — still exactly one wallet popup. Satisfies
   * deploy-before-fill + the allowance `enterPosition` needs, and makes every
   * subsequent order signature popup-less. Session-install failures degrade
   * to the plain deploy+approve onboarding (owner-key signing per order).
   *
   * `settlement` reaches here from the API (the composite market key), so the
   * allowance it receives bounds what a compromised backend could pull out of
   * this SCA. Callers pass a finite `amount` and top it up when it runs down;
   * omitting it keeps the historical unlimited allowance.
   */
  async onboard(args: { usdt: Address; settlement: Address; amount?: bigint }): Promise<Hex> {
    const calls: { to: Address; data: Hex; value?: bigint }[] = [
      { to: args.usdt, data: encodeApprove(args.settlement, args.amount ?? MAX_UINT256) },
    ];
    let record: OrderSessionRecord | null = null;
    if (sessionOrdersEnabled() && !(await this.sessionAccount().catch(() => null))) {
      try {
        const built = await this.buildSessionInstallCall();
        calls.push(built.call);
        record = built.record;
      } catch (e) {
        console.warn("[accountKit] session install prep failed — onboarding without a session", e);
      }
    }
    const txHash = await this.sendCalls(calls, args.usdt);
    if (record) this.persistOrderSession(record);
    return txHash;
  }

  /** Transfer USDT out of the SCA to `to` (UserOp). */
  async withdraw(args: { usdt: Address; to: Address; amount: bigint }): Promise<Hex> {
    return this.sendCalls([{ to: args.usdt, data: encodeTransfer(args.to, args.amount) }], args.usdt);
  }

  /** Send a single call from the SCA as a UserOp; returns the tx hash. */
  async sendCall(call: { to: Address; data: Hex; value?: bigint }): Promise<Hex> {
    return this.sendCalls([call]);
  }

  /**
   * Send one UserOp batching `calls` in order; returns the tx hash.
   *
   * `feeToken` overrides the configured sponsored-transfer fee token. The
   * collateral address is NOT hardcoded anywhere in the FE — it comes from the
   * backend's `/config` (the demo has already redeployed it once, on the
   * rain-token switch), so callers that hold it authoritatively pass it down.
   */
  private async sendCalls(
    calls: { to: Address; data: Hex; value?: bigint }[],
    feeToken?: Address,
  ): Promise<Hex> {
    if (!this._client || !this._account || !this._address) {
      throw new Error("Not connected. Call connect() first.");
    }
    const { toHex } = await import("viem");
    const capabilities: Record<string, unknown> = {};
    if (this.config.paymasterPolicyId && this.config.gasToken) {
      capabilities.paymasterService = {
        policyId: this.config.paymasterPolicyId,
        erc20: {
          tokenAddress: this.config.gasToken.tokenAddress,
          postOpSettings: { autoApprove: true },
        },
      };
    }

    // SPONSORED-TRANSFER (see lib/gasFee.ts): a SPONSORSHIP policy pays the ETH,
    // and we recover the cost as a plain ERC-20 transfer batched into THIS userOp.
    // It goes here, at the single choke point every UserOp passes through, so
    // onboard/withdraw/sendCall are all billed by construction — one place to get
    // right, and none to forget. Atomic: fee and action succeed or fail together.
    // Skipped when a gasToken is set (that's Alchemy's own ERC-20 paymaster
    // debiting in postOp — billing it twice would double-charge).
    const feeCollector = this.config.gasFeeCollector;
    const tok = feeToken ?? this.config.feeToken;
    let outCalls = calls;
    if (this.config.paymasterPolicyId && !this.config.gasToken && feeCollector && tok) {
      const { computeGasFeeTransfer } = await import("./gasFee");
      const quote = await computeGasFeeTransfer({
        client: this._client as unknown as { prepareCalls?: (a: unknown) => Promise<unknown> },
        from: this._address,
        policyId: this.config.paymasterPolicyId,
        feeToken: tok,
        actionCalls: calls,
        onLog: (m) => console.info(m),
      });
      // Fee FIRST: if the account can't cover it the whole userOp reverts before
      // the action lands, rather than doing the work and failing to bill.
      outCalls = [quote.transfer, ...calls];
    }

    const { id } = await this._client.sendCalls({
      from: this._address,
      calls: outCalls.map((c) => ({ to: c.to, data: c.data, value: toHex(c.value ?? BigInt(0)) })),
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
    });
    const status = await this._client.waitForCallsStatus({ id });
    const txHash = status.receipts?.[0]?.transactionHash as Hex | undefined;
    if (!txHash) throw new Error(`UserOp ${id} returned no transaction hash`);
    return txHash;
  }

  /**
   * Tear down the connection. Clears the persisted session key: `disconnect()`
   * is only ever reached from an EXPLICIT disconnect (the user's Disconnect
   * button, or wagmi settling on `status === "disconnected"`), and leaving a
   * live ERC-1271 signing key on disk after the user asked to disconnect is
   * exactly what they asked us not to do.
   *
   * This does NOT cost the popup-less reload UX. The ordinary reload path never
   * lands here: WalletContext returns early while wagmi is `connecting` /
   * `reconnecting`, and a page load that ends `disconnected` has no signer built
   * yet, so its `akRef.current?.disconnect()` is a no-op and the key survives to
   * be picked up by `readOrderSession` on the next connect. One onboarding popup
   * ever still holds for reloads — it is only "disconnect" that now means it.
   */
  disconnect(): void {
    this.revokeOrderSession(); // must run first — it needs `this._address`
    this._client = null;
    this._account = null;
    this._address = null;
    this._ownerEoa = null;
  }
}

/* ───────────────────────── calldata encoders ───────────────────────── */

export const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

/**
 * `amount` defaults to an unlimited (MAX_UINT256) allowance for source
 * compatibility with the SDK's `encodeApprove` (sdk/typescript/src/accountKit.ts),
 * but callers granting an allowance to a SERVER-SUPPLIED spender should always
 * pass a bounded amount — unlimited turns a hostile /markets response into a
 * total-loss path via `transferFrom`. See `onboard`.
 */
export function encodeApprove(spender: Address, amount: bigint = MAX_UINT256): Hex {
  // approve(address,uint256) selector 0x095ea7b3
  return ("0x095ea7b3" + pad(spender) + pad(amount)) as Hex;
}

function encodeTransfer(to: Address, amount: bigint): Hex {
  // transfer(address,uint256) selector 0xa9059cbb
  return ("0xa9059cbb" + pad(to) + pad(amount)) as Hex;
}

function pad(v: Address | bigint): string {
  const hex = typeof v === "bigint" ? v.toString(16) : v.toLowerCase().replace(/^0x/, "");
  return hex.padStart(64, "0");
}

/* ───────────────────────── FE factory ───────────────────────── */

/**
 * Build the signer from the FE env + the connected wagmi connector's
 * EIP-1193 provider. Gas mode is env-driven — FOUR modes now:
 *
 *   NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID unset → self-paid (SCA needs ETH)
 *   …set (SPONSORSHIP policy)               → sponsored, FREE to the user
 *   …set + NEXT_PUBLIC_GAS_FEE_COLLECTOR    → sponsored-transfer: no ETH needed,
 *                                             gas recovered in USDTm (lib/gasFee.ts)
 *   …set + NEXT_PUBLIC_AK_GAS_TOKEN         → Alchemy's ERC-20 paymaster debits a
 *                                             REGISTRY token (USDC/USDT₀ — never a
 *                                             mock; requires an ERC20-type policy)
 *
 * The policy TYPE must match the mode: sponsored/sponsored-transfer need a
 * SPONSORSHIP policy; the gasToken path needs an ERC20/ERC20_MANAGED one. Alchemy
 * rejects the mismatch outright ("Policy … is of type ERC20, but erc20 capability
 * is missing"), so a wrong pairing fails every send, not just some.
 */
export function createUpDownAccountKitSigner(provider: Eip1193Provider): UpDownAccountKitSigner {
  const policyId = process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID?.trim();
  const gasTokenAddr = process.env.NEXT_PUBLIC_AK_GAS_TOKEN?.trim();
  const feeCollector = process.env.NEXT_PUBLIC_GAS_FEE_COLLECTOR?.trim();
  const feeTokenEnv = process.env.NEXT_PUBLIC_GAS_FEE_TOKEN?.trim();
  return new UpDownAccountKitSigner({
    walletClient: provider,
    alchemyApiKey: ALCHEMY_API_KEY,
    ...(policyId ? { paymasterPolicyId: policyId } : {}),
    ...(policyId && gasTokenAddr ? { gasToken: { tokenAddress: gasTokenAddr as Address } } : {}),
    ...(policyId && !gasTokenAddr && feeCollector
      ? {
          gasFeeCollector: feeCollector as Address,
          // Optional fallback for the standalone session-install UserOp, which
          // has no collateral address in hand. onboard()/withdraw() pass theirs
          // from `/config` and never rely on this.
          ...(feeTokenEnv ? { feeToken: feeTokenEnv as Address } : {}),
        }
      : {}),
    chain: activeChain,
    rpcUrl: ALCHEMY_RPC_URL,
  });
}
