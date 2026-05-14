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
import { signMessage, getConnections } from "@wagmi/core";
import { createPublicClient, http, type PublicClient } from "viem";
import { useAtom, useAtomValue } from "jotai";
import { toast } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import { platform_chainId, ALCHEMY_RPC_URL, activeChain } from "@/config/environment";
import { LOGIN_SUCCESS, SIGNATURE_REJECTED } from "@/config/walletConstants";
import {
  userSmartAccount,
  userSmartAccountClient,
  userPublicClient,
  apiConfigAtom,
} from "@/store/atoms";
import { useThinWallet } from "@/hooks/useThinWallet";

/**
 * Phase 4 architecture (post 2026-05-14): the user's trading account is a
 * per-EOA ThinWallet auto-provisioned at first connect. The EOA owns the
 * TW (set as `owner` at construction) and signs orders via ERC-1271
 * WalletAuth wraps. The TW holds USDTM, approves Settlement, and is the
 * `order.maker` in all signed orders. Gas-free for the user end-to-end:
 *
 *   1. wagmi connect (MetaMask / WalletConnect / Coinbase Wallet)
 *   2. Verify-wallet personal_sign — the EOA signs its own address as a
 *      one-time identity proof (stored in localStorage at key `"sign"`).
 *   3. `useThinWallet` hook POSTs `/thin-wallet/provision` with that sig.
 *      Backend's relayer fires `factory.deployWallet(eoa)`. Idempotent —
 *      no-op if the TW already exists at the predicted CREATE2 address.
 *   4. `userSmartAccount` atom is set to the TW address. All downstream
 *      consumers (TradeForm, DepositModal, balance reads) route through it.
 *
 * Path-1 fallback: when the active chain doesn't have a deployed factory
 * (`config.thinWalletFactoryAddress` empty/missing), the hook stays idle
 * and the atom is set to the EOA — restoring pre-Phase-4 behavior. No
 * branching in downstream code.
 *
 * First-approve flow: TradeForm builds an `executeWithSig` envelope for
 * `USDTM.approve(Settlement, MAX)`, the EOA signs (free, gas-less typed-
 * data popup), the request goes to `/thin-wallet/execute-with-sig`, and
 * the relayer broadcasts. User signs 2 envelopes total during onboarding
 * (verify + approve); pays zero gas.
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
  /** No-op under Path 1; retained for back-compat with existing callers. */
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
  const apiConfig = useAtomValue(apiConfigAtom);
  const [, setPubClient] = useAtom(userPublicClient);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [showSignModal, setShowSignModal] = useState(false);
  const pendingSign = useRef(false);

  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const disconnectWallet = useCallback(() => {
    disconnect();
    setSmartAccount("");
    setSmartAccountClient(null);
    setPubClient(null);
    pendingSign.current = false;
    localStorage.removeItem("connectorId");
    localStorage.removeItem("flag");
    localStorage.removeItem("lastAccount");
    localStorage.removeItem("sign");
    localStorage.removeItem("userlastconnectorId");
  }, [disconnect, setSmartAccount, setSmartAccountClient, setPubClient]);

  const performSign = useCallback(
    async (walletAddr: string) => {
      try {
        setIsLoading(true);
        setLoadingStep("Confirm signature request");

        if (connectedChainId !== platform_chainId) {
          await switchChainAsync({ chainId: platform_chainId });
        }

        const connections = getConnections(wagmiConfig);
        const activeConnector = connections[0]?.connector;
        if (!activeConnector) throw new Error("No connector");

        const signData = await signMessage(wagmiConfig, {
          connector: activeConnector,
          message: walletAddr.toLowerCase(),
        });

        const lastConnectorId = localStorage.getItem("userlastconnectorId");
        if (lastConnectorId) {
          localStorage.setItem("connectorId", lastConnectorId);
        }
        localStorage.setItem("sign", signData);
        localStorage.setItem("lastAccount", walletAddr);

        return signData;
      } catch (error) {
        setLoadingStep("");
        setIsLoading(false);
        toast.error(SIGNATURE_REJECTED);
        disconnectWallet();
        console.error("Signing failed:", error);
        return null;
      }
    },
    [connectedChainId, switchChainAsync, disconnectWallet],
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

        if (result?.accounts?.[0]) {
          pendingSign.current = true;
        }
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

  useEffect(() => {
    if (!pendingSign.current || !address || !walletClient) return;
    pendingSign.current = false;
    setIsLoading(false);
    setLoadingStep("");
    setShowSignModal(true);
  }, [address, walletClient]);

  // Bug G: when a user clicks Connect, we wait for [address, walletClient] to
  // both populate before showing the sign modal. If walletClient never resolves
  // (extension stuck, wallet disconnected mid-flow), the spinner used to hang
  // forever. Cap at 30s, reset state, and tell the user to retry.
  useEffect(() => {
    if (!pendingSign.current) return;
    const timer = setTimeout(() => {
      if (!pendingSign.current) return;
      pendingSign.current = false;
      setIsLoading(false);
      setLoadingStep("");
      toast.error("Wallet connection timed out. Please try again.");
      try {
        disconnect();
      } catch {
        /* ignore */
      }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [disconnect]);

  const handleSign = useCallback(async () => {
    if (!address || !walletClient) return;
    setShowSignModal(false);
    setIsLoading(true);

    const signData = await performSign(address);
    if (!signData) return;

    // F1 fix (2026-05-14): propagate the freshly-stored verify-wallet sig
    // into local component state IMMEDIATELY. The localStorage write inside
    // performSign() doesn't trigger Effect 1's useEffect (whose dep is
    // `[address]` only — address hasn't changed across this sign flow). Without
    // this set call, `storedVerifySig` stays at its previous value (null for
    // a fresh user), `useThinWallet` never fires, and `userSmartAccount`
    // atom never gets set to the TW address. Consumers (Header,
    // DepositModal, TradeForm) then fall back to the EOA, breaking every
    // user-facing Phase 4 invariant. Setting state directly here re-triggers
    // the atom-setting Effect 2 via its `storedVerifySig` dependency.
    setStoredVerifySig(signData);

    toast.success(LOGIN_SUCCESS);
    setLoadingStep("");
    setIsLoading(false);
  }, [address, walletClient, performSign]);

  /** No-op under Path 1; retained so existing toast-action handlers don't break. */
  const reauthorizeSession = useCallback(async () => {
    /* no-op */
  }, []);

  const closeSignModal = useCallback(() => {
    setShowSignModal(false);
    disconnectWallet();
  }, [disconnectWallet]);

  // Phase 4: read the stored verify-wallet sig so `useThinWallet` can
  // POST /thin-wallet/provision on connect (or on reload, for returning
  // users). null until the user signs the verify-wallet message; the
  // restore branch sets it from localStorage so reloads don't re-prompt.
  const [storedVerifySig, setStoredVerifySig] = useState<string | null>(null);
  useEffect(() => {
    if (!address) {
      setStoredVerifySig(null);
      return;
    }
    if (pendingSign.current) return;
    const sig = typeof window !== "undefined" ? localStorage.getItem("sign") : null;
    setStoredVerifySig(sig);
  }, [address]);

  // Phase 4: TW provisioning. Enabled when the backend exposes a factory
  // address on this chain; otherwise the hook stays idle and we fall
  // back to writing the EOA into `userSmartAccount` (Path-1 behavior).
  const factoryAddress = apiConfig?.thinWalletFactoryAddress;
  const thinWalletEnabled = Boolean(factoryAddress && factoryAddress.length > 0);
  const { twAddress, isProvisioning, error: twError } = useThinWallet({
    eoa: address as `0x${string}` | undefined,
    verifySignature: storedVerifySig,
    enabled: thinWalletEnabled,
  });

  useEffect(() => {
    if (twError) {
      toast.error(`ThinWallet provisioning failed: ${twError.message}`);
    }
  }, [twError]);

  // Reflect the active trading identity into `userSmartAccount`:
  //   - Phase 4 chain (factory present) + provisioning succeeded → TW addr
  //   - Path-1 chain (no factory) + verify-wallet sig present → EOA addr
  //   - Otherwise → "" (consumers gate trading on non-empty)
  useEffect(() => {
    if (!address || !storedVerifySig) return;
    if (thinWalletEnabled) {
      if (twAddress) setSmartAccount(twAddress);
    } else {
      setSmartAccount(address);
    }
  }, [address, storedVerifySig, thinWalletEnabled, twAddress, setSmartAccount]);

  // Loading step copy for the connect-flow spinner. Composed from the
  // verify-wallet phase + the TW-provisioning phase so the user sees one
  // continuous progression: "Confirm signature request" →
  // "Setting up your account…" → trade-ready.
  useEffect(() => {
    if (isProvisioning) {
      setLoadingStep("Setting up your account…");
      setIsLoading(true);
    } else if (isLoading && loadingStep === "Setting up your account…") {
      setLoadingStep("");
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProvisioning]);

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
    showSignModal,
    handleSign,
    reauthorizeSession,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
