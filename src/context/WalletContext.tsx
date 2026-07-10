"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useConnect,
  useDisconnect,
  useAccount,
  useWalletClient,
  useChainId,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { getConnections } from "@wagmi/core";
import { createPublicClient, http, type PublicClient } from "viem";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import { platform_chainId, ALCHEMY_RPC_URL, activeChain } from "@/config/environment";
import { LOGIN_SUCCESS } from "@/config/walletConstants";
import {
  userSmartAccount,
  userSmartAccountClient,
  userPublicClient,
} from "@/store/atoms";
import {
  createUpDownAccountKitSigner,
  readCachedSA,
  type Eip1193Provider,
  type UpDownAccountKitSigner,
} from "@/lib/accountKit";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Account Kit architecture (2026-07-05, replacing Phase-4 ThinWallet):
 * the user's trading account is an Alchemy smart-contract account (SCA)
 * derived deterministically from the owner EOA — the same derivation
 * rain.trade's `RainAA` uses, so one EOA = one wallet across products.
 *
 *   1. wagmi connect (MetaMask / WalletConnect / Coinbase Wallet)
 *   2. `UpDownAccountKitSigner.connect()` resolves the SCA address from
 *      the Alchemy wallet server. No signature, no backend provisioning.
 *   3. `userSmartAccount` atom = SCA address; `userSmartAccountClient`
 *      atom = the signer. All downstream consumers (TradeForm,
 *      DepositModal, WS auth, balance reads) route through them.
 *
 * Onboarding (deploy + approve) happens lazily on the first trade — see
 * TradeForm's `ensureSettlementAllowance`: one UserOp deploys the SCA and
 * approves the settlement. Orders/cancels are signed by the OWNER key as
 * bare ERC-1271 typed-data (`signTypedDataBare`); there is no WalletAuth
 * wrap and no relayer meta-tx surface anymore.
 */
export interface WalletContextValue {
  isWalletConnected: boolean;
  isLoading: boolean;
  loadingStep: string;
  walletAddress: string | undefined;
  connectWallet: (connector: Connector) => Promise<void>;
  disconnectWallet: () => void;
  showSignModal: boolean;
  handleSign: () => void;
  closeSignModal: () => void;
  /** No-op; retained for back-compat with existing callers. */
  reauthorizeSession: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [, setSmartAccount] = useAtom(userSmartAccount);
  const [, setSmartAccountClient] = useAtom(userSmartAccountClient);
  const [, setPubClient] = useAtom(userPublicClient);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");

  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { address, isConnected, status, connector } = useAccount();
  const { data: walletClient } = useWalletClient();
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  /** The signer instance + which EOA it was built for (rebuild on switch). */
  const akRef = useRef<UpDownAccountKitSigner | null>(null);
  const akOwnerRef = useRef<string | null>(null);
  const setupInFlightRef = useRef(false);

  const disconnectWallet = useCallback(() => {
    disconnect();
    akRef.current?.disconnect();
    akRef.current = null;
    akOwnerRef.current = null;
    setSmartAccount("");
    setSmartAccountClient(null);
    setPubClient(null);
    localStorage.removeItem("connectorId");
    localStorage.removeItem("flag");
    localStorage.removeItem("lastAccount");
    localStorage.removeItem("userlastconnectorId");
  }, [disconnect, setSmartAccount, setSmartAccountClient, setPubClient]);

  /**
   * PR-Y (2026-05-20): chain-switch error UX fix.
   *
   * Three failure modes distinguished:
   *   - 4902 (chain not added): call `wallet_addEthereumChain` with the
   *     active chain params + retry switch. Single MetaMask popup
   *     for the user to approve adding the network.
   *   - 4001 (user rejected the popup): "You cancelled" — softer copy.
   *   - other: surface the actual error message so the user sees what
   *     went wrong (RPC unreachable, wallet bug, etc.).
   */
  const ensurePlatformChain = useCallback(async (): Promise<void> => {
    if (connectedChainId === platform_chainId) return;
    try {
      await switchChainAsync({ chainId: platform_chainId });
      return;
    } catch (switchErr: unknown) {
      const e = switchErr as { code?: number | string; message?: string };
      const code = typeof e?.code === "number" ? e.code : Number(e?.code);
      const msg = e?.message ?? "";
      const isChainNotAdded =
        code === 4902 ||
        /unrecognized chain id|chain id .* not added|switchEthereumChain|wallet_switchEthereumChain/i.test(msg);
      if (!isChainNotAdded) throw switchErr;

      // Fallback: ask the wallet to add the chain, then retry switch.
      const provider = await walletClient?.transport?.request
        ? walletClient
        : null;
      if (!provider) throw switchErr;
      const params = [{
        chainId: `0x${platform_chainId.toString(16)}`,
        chainName: activeChain.name,
        nativeCurrency: activeChain.nativeCurrency,
        rpcUrls: [ALCHEMY_RPC_URL, ...(activeChain.rpcUrls?.default?.http ?? [])].filter(Boolean),
        blockExplorerUrls: activeChain.blockExplorers?.default?.url
          ? [activeChain.blockExplorers.default.url]
          : [],
      }];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).transport.request({
        method: "wallet_addEthereumChain",
        params,
      });
      // Retry the switch once the chain is added.
      await switchChainAsync({ chainId: platform_chainId });
    }
  }, [connectedChainId, switchChainAsync, walletClient]);

  /**
   * Build the Account Kit signer for the connected EOA and resolve the SCA.
   * Idempotent per EOA; rebuilds when the user switches accounts.
   *
   * `activeConnector` is passed in from `useAccount().connector` (atomic with
   * `address`) rather than read from `getConnections(wagmiConfig)` — the latter
   * can momentarily return `[]` during wagmi's reconnect-on-reload, and the old
   * code threw "No connector" there and then WIPED custody (that was the
   * "wallet reset on refresh" bug).
   *
   * `silent` suppresses the success toast (reload-restore path). `wipeOnError`
   * gates the destructive teardown: TRUE only for an explicit user-initiated
   * connect — a reload/restore or manual retry must NEVER wipe the wagmi
   * connection on a transient failure (that is the whole bug). On the no-wipe
   * path we also bounded-retry `connect()` so a brief Alchemy blip self-heals.
   */
  const setupAccountKit = useCallback(
    async (
      walletAddr: string,
      activeConnector: Connector | undefined,
      opts?: { silent?: boolean; wipeOnError?: boolean },
    ) => {
      if (setupInFlightRef.current) return;
      if (akRef.current && akOwnerRef.current === walletAddr.toLowerCase()) return;
      setupInFlightRef.current = true;
      const wipeOnError = opts?.wipeOnError ?? false;
      try {
        setIsLoading(true);
        setLoadingStep("Setting up your account…");

        // Hydrate the deterministic SCA from cache immediately so a reload never
        // flashes a disconnected state while ak.connect() round-trips Alchemy.
        const cachedSca = readCachedSA(walletAddr);
        if (cachedSca) setSmartAccount(cachedSca);

        // Only force the platform chain on an explicit user connect. A silent
        // reload-restore must not surface a chain-switch popup; the trade flow
        // switches on demand, and SCA resolution is chain-agnostic anyway.
        if (wipeOnError) await ensurePlatformChain();

        // Race-free connector resolution (see doc comment); fall back to
        // getConnections only if useAccount somehow handed us nothing.
        let connectorForProvider = activeConnector;
        if (!connectorForProvider) {
          connectorForProvider = getConnections(wagmiConfig)[0]?.connector;
        }
        if (!connectorForProvider) throw new Error("No connector");
        const provider = (await connectorForProvider.getProvider()) as Eip1193Provider;

        const ak = createUpDownAccountKitSigner(provider);

        // Bounded retry on the restore/retry path so a transient Alchemy blip
        // doesn't strand the session; the wallet stays connected throughout.
        const maxAttempts = wipeOnError ? 1 : 4;
        let sca: string | null = null;
        let lastErr: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            sca = await ak.connect();
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < maxAttempts - 1) await sleep(1200 * (attempt + 1));
          }
        }
        if (!sca) throw lastErr ?? new Error("Failed to resolve smart account");

        akRef.current = ak;
        akOwnerRef.current = walletAddr.toLowerCase();
        setSmartAccount(sca);
        setSmartAccountClient(ak);
        localStorage.setItem("lastAccount", walletAddr);
        if (!opts?.silent) toast.success(LOGIN_SUCCESS);
      } catch (error: unknown) {
        const e = error as { code?: number | string; message?: string };
        const code = typeof e?.code === "number" ? e.code : Number(e?.code);
        const msg = (e?.message ?? "").trim();
        const isUserReject =
          code === 4001 || /user rejected|user denied|denied by user|4001/i.test(msg);
        const isChainNotAdded =
          code === 4902 ||
          /unrecognized chain id|wallet_addEthereumChain|switchEthereumChain/i.test(msg);
        if (wipeOnError) {
          if (isUserReject) {
            toast.error("You cancelled the wallet request.");
          } else if (isChainNotAdded) {
            toast.error(
              `Couldn't switch to ${activeChain.name}. Please add the network manually in your wallet and try again.`,
            );
          } else {
            toast.error(msg || "Couldn't set up your trading account. Please try again.");
          }
          disconnectWallet();
          console.error("Account Kit setup failed:", error);
        } else {
          // Reload-restore / manual retry: NEVER wipe custody on a transient
          // failure — that is exactly the "wallet reset on refresh" bug. Keep
          // the wagmi connection (and the cached SCA address) on screen; the
          // signer re-attaches on the next connector change or manual retry.
          console.warn("Account Kit restore failed (wallet kept connected):", error);
        }
      } finally {
        setupInFlightRef.current = false;
        setLoadingStep("");
        setIsLoading(false);
      }
    },
    [ensurePlatformChain, disconnectWallet, setSmartAccount, setSmartAccountClient],
  );

  const connectWallet = useCallback(
    async (connector: Connector) => {
      try {
        setIsLoading(true);
        setLoadingStep("Confirm wallet connection");

        const result = await connectAsync(
          connector?.name === "WalletConnect"
            ? { connector }
            : { connector, chainId: platform_chainId },
        );

        localStorage.setItem("connectorId", connector?.name ?? "");
        localStorage.setItem("flag", "true");
        localStorage.setItem("userlastconnectorId", connector?.name ?? "");

        // The [address, walletClient] effect below picks up the fresh
        // connection and runs the Account Kit setup.
        void result;
      } catch (error) {
        // Bug H: failure used to be silent (only console.error), so user saw
        // button → spinner → button with no feedback. Surface clean copy via
        // sonner. User-rejections get a softer message; everything else gets
        // a "try again" prompt.
        console.error("Wallet connection failed:", error);
        const msg =
          error instanceof Error && /user rejected|denied|4001/i.test(error.message)
            ? "Connection cancelled in wallet."
            : "Couldn't connect to wallet. Please try again.";
        toast.error(msg);
        setLoadingStep("");
        setIsLoading(false);
        localStorage.removeItem("connectorId");
        localStorage.removeItem("flag");
      }
    },
    [connectAsync],
  );

  // Run the Account Kit setup whenever a wallet lands (fresh connect or
  // wagmi's reconnect-on-reload) or the user switches accounts. We gate on
  // wagmi `status` so we only fire once the connection has settled — never
  // mid-reconnect (when `getConnections()` can be empty) — and drive the setup
  // off `connector` (atomic with `address`), NOT `walletClient` (a lagging
  // react-query hook). `isRestore` (this EOA matches the last one we set up)
  // makes the reload path silent AND non-destructive on failure.
  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") return;
    if (!address || !connector) return;
    if (akRef.current && akOwnerRef.current === address.toLowerCase()) return;
    const isRestore = localStorage.getItem("lastAccount")?.toLowerCase() === address.toLowerCase();
    void setupAccountKit(address, connector, { silent: isRestore, wipeOnError: !isRestore });
  }, [status, address, connector, setupAccountKit]);

  // Wallet FULLY disconnected → clear state. Gate on the definitive
  // `disconnected` status (not merely `!address`) so the transient address-less
  // window during wagmi's reconnect-on-reload does NOT clear the account.
  useEffect(() => {
    if (status !== "disconnected") return;
    akRef.current?.disconnect();
    akRef.current = null;
    akOwnerRef.current = null;
    setSmartAccount("");
    setSmartAccountClient(null);
    setPubClient(null);
  }, [status, setSmartAccount, setSmartAccountClient, setPubClient]);

  /** Legacy sign-modal surface — Account Kit needs no verify signature.
   *  `handleSign` retries the setup (kept for Header's modal wiring). Surfaces
   *  errors (not silent) but does NOT wipe custody on failure. */
  const handleSign = useCallback(() => {
    if (address && connector)
      void setupAccountKit(address, connector, { silent: false, wipeOnError: false });
  }, [address, connector, setupAccountKit]);

  /** No-op; retained so existing toast-action handlers don't break. */
  const reauthorizeSession = useCallback(async () => {
    /* no-op */
  }, []);

  const closeSignModal = useCallback(() => {
    /* modal never opens under Account Kit */
  }, []);

  useEffect(() => {
    if (address) {
      setPubClient(
        createPublicClient({
          chain: activeChain,
          transport: http(ALCHEMY_RPC_URL),
        }) as PublicClient,
      );
    }
  }, [address, setPubClient]);

  const value: WalletContextValue = {
    isWalletConnected: isConnected && !!address,
    isLoading,
    loadingStep,
    walletAddress: address,
    connectWallet,
    disconnectWallet,
    closeSignModal,
    showSignModal: false,
    handleSign,
    reauthorizeSession,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
