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
import { arbitrum } from "viem/chains";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import { platform_chainId, ALCHEMY_RPC_URL } from "@/config/environment";
import { LOGIN_SUCCESS, SIGNATURE_REJECTED } from "@/config/walletConstants";
import {
  userSmartAccount,
  userSmartAccountClient,
  userPublicClient,
} from "@/store/atoms";

/**
 * Path-1 architecture (post Step 7 cleanup): the trading account IS the
 * connected EOA. There is no Alchemy MA v2 smart account in the trading
 * path, no scoped session, no paymaster. The connect flow is:
 *
 *   1. wagmi connect (MetaMask / WalletConnect / Coinbase Wallet)
 *   2. Verify-wallet personal_sign — the EOA signs its own address as a
 *      one-time identity proof so localStorage knows we've onboarded this
 *      wallet (used to skip the popup on subsequent visits).
 *   3. `userSmartAccount` atom is set to the EOA address. The "smart
 *      account" naming in the atom is back-compat for read paths that
 *      still reference it; under Path 1 it always equals the EOA.
 *
 * The `reauthorizeSession` API is kept (no-op) so existing callers don't
 * break. First-trade `USDT.approve(settlement)` is handled in TradeForm
 * via wagmi `useWriteContract`, not here.
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
        console.error("Wallet connection failed:", error);
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

  const handleSign = useCallback(async () => {
    if (!address || !walletClient) return;
    setShowSignModal(false);
    setIsLoading(true);

    const signData = await performSign(address);
    if (!signData) return;

    // Path-1: the EOA is the trading account. Set the atom (still named
    // `userSmartAccount` for back-compat with read paths) to the EOA.
    setSmartAccount(address);

    toast.success(LOGIN_SUCCESS);
    setLoadingStep("");
    setIsLoading(false);
  }, [address, walletClient, performSign, setSmartAccount]);

  /** No-op under Path 1; retained so existing toast-action handlers don't break. */
  const reauthorizeSession = useCallback(async () => {
    /* no-op */
  }, []);

  const closeSignModal = useCallback(() => {
    setShowSignModal(false);
    disconnectWallet();
  }, [disconnectWallet]);

  // Restore: if localStorage already has a verify-wallet signature for the
  // current address, treat the connection as fully ready without re-prompting.
  useEffect(() => {
    if (!address || !localStorage.getItem("sign")) return;
    if (pendingSign.current) return;
    setSmartAccount(address);
  }, [address, setSmartAccount]);

  useEffect(() => {
    if (address) {
      setPubClient(
        createPublicClient({
          chain: arbitrum,
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
