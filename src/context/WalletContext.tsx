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
  type Eip1193Provider,
  type UpDownAccountKitSigner,
} from "@/lib/accountKit";

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
  const { address, isConnected } = useAccount();
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
   * Idempotent per EOA; rebuilds when the user switches accounts. `silent`
   * suppresses the success toast (reload-restore path).
   */
  const setupAccountKit = useCallback(
    async (walletAddr: string, opts?: { silent?: boolean }) => {
      if (setupInFlightRef.current) return;
      if (akRef.current && akOwnerRef.current === walletAddr.toLowerCase()) return;
      setupInFlightRef.current = true;
      try {
        setIsLoading(true);
        setLoadingStep("Setting up your account…");

        await ensurePlatformChain();

        const connections = getConnections(wagmiConfig);
        const activeConnector = connections[0]?.connector;
        if (!activeConnector) throw new Error("No connector");
        const provider = (await activeConnector.getProvider()) as Eip1193Provider;

        const ak = createUpDownAccountKitSigner(provider);
        const sca = await ak.connect();

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
  // wagmi's reconnect-on-reload) or the user switches accounts. `silent`
  // when restoring a previous session so reloads don't toast.
  useEffect(() => {
    if (!address || !walletClient) return;
    if (akRef.current && akOwnerRef.current === address.toLowerCase()) return;
    const isRestore = localStorage.getItem("lastAccount")?.toLowerCase() === address.toLowerCase();
    void setupAccountKit(address, { silent: isRestore });
  }, [address, walletClient, setupAccountKit]);

  // Wallet fully disconnected (extension side or programmatic) → clear state.
  useEffect(() => {
    if (address) return;
    if (!akRef.current) return;
    akRef.current.disconnect();
    akRef.current = null;
    akOwnerRef.current = null;
    setSmartAccount("");
    setSmartAccountClient(null);
  }, [address, setSmartAccount, setSmartAccountClient]);

  /** Legacy sign-modal surface — Account Kit needs no verify signature.
   *  `handleSign` retries the setup (kept for Header's modal wiring). */
  const handleSign = useCallback(() => {
    if (address) void setupAccountKit(address);
  }, [address, setupAccountKit]);

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
