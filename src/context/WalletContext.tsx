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
import { getDefaultStore, useAtom, useAtomValue } from "jotai";
import { toast } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import {
  platform_chainId,
  ALCHEMY_API_KEY,
  PAYMASTER_POLICY_ID,
  ALCHEMY_RPC_URL,
  SESSION_USDT_ALLOWANCE_BASE_UNITS,
  SESSION_GAS_LIMIT,
} from "@/config/environment";
import { LOGIN_SUCCESS, SIGNATURE_REJECTED } from "@/config/walletConstants";
import {
  userSmartAccount,
  userSmartAccountClient,
  userPublicClient,
  apiConfigAtom,
  sessionReadyAtom,
  sessionRestoreFailedAtom,
  sessionAmountUsedAtom,
} from "@/store/atoms";
import { getConfig, registerSmartAccount } from "@/lib/api";
import {
  grantScopedSessionIfNeeded,
  readStoredScopedSessionIfValid,
} from "@/lib/grantSessionPermissions";
import { deleteIndexKey } from "@/utils/indexDb";

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
  /** Re-run scoped grant + backend register (e.g. after expiry or failed restore). */
  reauthorizeSession: () => Promise<void>;
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
  const smartAccountClientValue = useAtomValue(userSmartAccountClient);
  const [, setPubClient] = useAtom(userPublicClient);
  const [sessionReady, setSessionReady] = useAtom(sessionReadyAtom);
  const [, setSessionRestoreFailed] = useAtom(sessionRestoreFailedAtom);
  const [, setSessionAmountUsed] = useAtom(sessionAmountUsedAtom);

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
    setSessionReady(false);
    pendingSign.current = false;
    localStorage.removeItem("connectorId");
    localStorage.removeItem("flag");
    localStorage.removeItem("lastAccount");
    localStorage.removeItem("sign");
    localStorage.removeItem("sessionExpiryTime");
    localStorage.removeItem("userlastconnectorId");
    void deleteIndexKey("sessionKeyData");
  }, [disconnect, setSmartAccount, setSmartAccountClient, setPubClient, setSessionReady]);

  const createSmartAccountFn = useCallback(
    async (
      wc: NonNullable<typeof walletClient>
    ): Promise<{ address: string; client: unknown } | null> => {
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
        return { address: addr, client };
      } catch (error) {
        console.error("Error creating smart account:", error);
        return null;
      }
    },
    [setSmartAccount, setSmartAccountClient]
  );

  const syncScopedSessionAndRegister = useCallback(
    async (params: {
      eoaAddress: string;
      saAddress: string;
      saClient: unknown;
      showToasts?: boolean;
    }): Promise<boolean> => {
      const { eoaAddress, saAddress, saClient, showToasts = true } = params;

      let cfg = getDefaultStore().get(apiConfigAtom);
      if (!cfg) {
        try {
          cfg = await getConfig();
          getDefaultStore().set(apiConfigAtom, cfg);
        } catch (err) {
          console.error("Failed to load API config:", err);
          if (showToasts) toast.error("Could not load config");
          return false;
        }
      }

      let artifact = await readStoredScopedSessionIfValid();
      if (!artifact) {
        if (showToasts) setLoadingStep("Authorizing trading session...");
        artifact = await grantScopedSessionIfNeeded(saClient, saAddress, {
          settlementAddress: cfg.eip712.domain.verifyingContract,
          usdtAddress: cfg.usdtAddress as `0x${string}`,
          usdtAllowance: SESSION_USDT_ALLOWANCE_BASE_UNITS,
          gasLimit: SESSION_GAS_LIMIT,
        });
      }

      if (!artifact) {
        if (showToasts) toast.error("Failed to authorize trading session");
        return false;
      }

      if (showToasts) setLoadingStep("Registering with server...");
      try {
        await registerSmartAccount({
          ownerAddress: eoaAddress,
          smartAccountAddress: saAddress,
          sessionKey: artifact.privateKey,
          sessionExpiry: artifact.sessionExpiry,
          permissionsContext: artifact.permissionsContext,
          ...(artifact.sessionSignerAddress
            ? { sessionSignerAddress: artifact.sessionSignerAddress }
            : {}),
          sessionScope: {
            settlementAddress: cfg.eip712.domain.verifyingContract,
            functionSelector: artifact.functionSelector,
            usdtAllowance: SESSION_USDT_ALLOWANCE_BASE_UNITS.toString(),
          },
        });
        setSessionReady(true);
        // Option C — reset the tab-scoped "amount signed this session" counter
        // on every successful session (re)init. Per-page-load scope is
        // acceptable UX: the remaining-allowance preview is a soft guide, and
        // the on-chain MA v2 module is the authority on actual cap enforcement.
        setSessionAmountUsed("0");
        return true;
      } catch (err) {
        console.error("Register smart account failed:", err);
        if (showToasts) toast.error("Could not register session with backend");
        return false;
      }
    },
    [setSessionReady, setLoadingStep, setSessionAmountUsed]
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
    const sa = await createSmartAccountFn(walletClient);
    if (!sa) {
      setLoadingStep("");
      setIsLoading(false);
      return;
    }

    const ok = await syncScopedSessionAndRegister({
      eoaAddress: address,
      saAddress: sa.address,
      saClient: sa.client,
      showToasts: true,
    });
    if (!ok) {
      setLoadingStep("");
      setIsLoading(false);
      return;
    }

    toast.success(LOGIN_SUCCESS);
    setLoadingStep("");
    setIsLoading(false);
  }, [address, walletClient, performSign, createSmartAccountFn, syncScopedSessionAndRegister]);

  const reauthorizeSession = useCallback(async () => {
    if (!address || !smartAccount || !smartAccountClientValue) {
      toast.error("Wallet or smart account not ready");
      return;
    }
    setIsLoading(true);
    const ok = await syncScopedSessionAndRegister({
      eoaAddress: address,
      saAddress: smartAccount,
      saClient: smartAccountClientValue,
      showToasts: true,
    });
    setLoadingStep("");
    setIsLoading(false);
    if (ok) {
      setSessionRestoreFailed(false);
      toast.dismiss("session-restore-fail");
      toast.success("Trading session renewed");
    }
  }, [address, smartAccount, smartAccountClientValue, syncScopedSessionAndRegister, setSessionRestoreFailed]);

  const closeSignModal = useCallback(() => {
    setShowSignModal(false);
    disconnectWallet();
  }, [disconnectWallet]);

  useEffect(() => {
    if (!address || !walletClient || !localStorage.getItem("sign")) return;
    if (pendingSign.current) return;

    if (!smartAccount) {
      void createSmartAccountFn(walletClient);
      return;
    }

    if (!smartAccountClientValue) return;
    if (sessionReady) return;

    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setLoadingStep("Reconnecting…");
      try {
        const first = await syncScopedSessionAndRegister({
          eoaAddress: address,
          saAddress: smartAccount,
          saClient: smartAccountClientValue,
          showToasts: false,
        });
        if (cancelled) return;
        if (first) return;

        // Single retry with 2s backoff — covers brief backend deploys / network blips.
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) return;
        const second = await syncScopedSessionAndRegister({
          eoaAddress: address,
          saAddress: smartAccount,
          saClient: smartAccountClientValue,
          showToasts: false,
        });
        if (cancelled) return;
        if (second) return;

        // Both attempts failed. Surface the failure so the user can act, instead of
        // staring at a silent "Reconnecting…" with trading blocked.
        console.error("Session restore failed after retry — showing re-authorize CTA");
        setSessionRestoreFailed(true);
        toast.error("Couldn't restore your trading session. Please re-authorize.", {
          id: "session-restore-fail",
          duration: Infinity,
          action: {
            label: "Re-authorize",
            onClick: () => {
              void reauthorizeSession();
            },
          },
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setLoadingStep("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    address,
    walletClient,
    smartAccount,
    smartAccountClientValue,
    sessionReady,
    createSmartAccountFn,
    syncScopedSessionAndRegister,
    setSessionRestoreFailed,
    reauthorizeSession,
  ]);

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
    connectWallet,
    disconnectWallet,
    closeSignModal,
    showSignModal,
    handleSign,
    reauthorizeSession,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
