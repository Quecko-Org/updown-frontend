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
import { createWalletClient, custom, createPublicClient, http, type PublicClient } from "viem";
import { arbitrum, alchemy } from "@account-kit/infra";
import { WalletClientSigner } from "@aa-sdk/core";
import { createSmartWalletClient } from "@account-kit/wallet-client";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import {
  platform_chainId,
  ALCHEMY_API_KEY,
  PAYMASTER_POLICY_ID,
  ALCHEMY_RPC_URL,
} from "@/config/environment";
import { LOGIN_SUCCESS, SIGNATURE_REJECTED } from "@/config/walletConstants";
import { userSmartAccount, userSmartAccountClient, userPublicClient } from "@/store/atoms";
import { deleteIndexKey } from "@/utils/indexDb";

export interface WalletContextValue {
  isWalletConnected: boolean;
  isLoading: boolean;
  loadingStep: string;
  walletAddress: string | undefined;
  smartAccountAddress: string;
  connectWallet: (connector: Connector) => Promise<void>;
  disconnectWallet: () => void;
  showSignModal: boolean;
  handleSign: () => void;
  closeSignModal: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [smartAccount, setSmartAccount] = useAtom(userSmartAccount);
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
    localStorage.removeItem("sessionExpiryTime");
    localStorage.removeItem("userlastconnectorId");
    void deleteIndexKey("sessionKeyData");
  }, [disconnect, setSmartAccount, setSmartAccountClient, setPubClient]);

  const createSmartAccountFn = useCallback(
    async (wc: NonNullable<typeof walletClient>) => {
      try {
        const signer = new WalletClientSigner(
          createWalletClient({
            chain: arbitrum,
            transport: custom(wc),
          }),
          "wallet"
        );

        const client = createSmartWalletClient({
          transport: alchemy({ apiKey: ALCHEMY_API_KEY }),
          chain: arbitrum,
          signer,
          policyId: PAYMASTER_POLICY_ID,
        });

        const smartAccountAddress = await (
          client as ReturnType<typeof createSmartWalletClient>
        ).requestAccount();
        const addr = smartAccountAddress?.address as string;
        setSmartAccount(addr);
        setSmartAccountClient(client);
        return addr;
      } catch (error) {
        console.error("Error creating smart account:", error);
        return null;
      }
    },
    [setSmartAccount, setSmartAccountClient]
  );

  const performSign = useCallback(
    async (walletAddr: string) => {
      try {
        setIsLoading(true);
        setLoadingStep("Confirm signature request from your wallet");

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
    [connectedChainId, switchChainAsync, disconnectWallet]
  );

  const connectWallet = useCallback(
    async (connector: Connector) => {
      try {
        setIsLoading(true);
        setLoadingStep("Confirm wallet connection from your wallet");

        const result = await connectAsync(
          connector?.name === "WalletConnect"
            ? { connector }
            : { connector, chainId: platform_chainId }
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
    [connectAsync]
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

    setLoadingStep("Setting up your account...");
    await createSmartAccountFn(walletClient);
    toast.success(LOGIN_SUCCESS);

    setLoadingStep("");
    setIsLoading(false);
  }, [address, walletClient, performSign, createSmartAccountFn]);

  const closeSignModal = useCallback(() => {
    setShowSignModal(false);
    disconnectWallet();
  }, [disconnectWallet]);

  useEffect(() => {
    if (
      address &&
      walletClient &&
      !smartAccount &&
      !pendingSign.current &&
      localStorage.getItem("sign")
    ) {
      void createSmartAccountFn(walletClient);
    }
  }, [address, walletClient, smartAccount, createSmartAccountFn]);

  useEffect(() => {
    if (smartAccount) {
      setPubClient(
        createPublicClient({
          chain: arbitrum,
          transport: http(ALCHEMY_RPC_URL),
        }) as PublicClient
      );
    }
  }, [smartAccount, setPubClient]);

  useEffect(() => {
    if (address && smartAccount) {
      const lastConnectedAccount = localStorage.getItem("lastAccount");
      if (lastConnectedAccount && lastConnectedAccount !== address) {
        localStorage.removeItem("sessionExpiryTime");
      }
    }
  }, [address, smartAccount]);

  const value: WalletContextValue = {
    isWalletConnected: isConnected && !!address,
    isLoading,
    loadingStep,
    walletAddress: address,
    smartAccountAddress: smartAccount,
    connectWallet,
    disconnectWallet,
    closeSignModal,
    showSignModal,
    handleSign,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
