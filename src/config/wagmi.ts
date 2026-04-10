import { createConfig, http } from "wagmi";
import { mainnet, arbitrum } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { ALCHEMY_RPC_URL } from "./environment";

/**
 * Same structure as speed-market `app/config/wagmi.ts`:
 * MetaMask (injected), WalletConnect, Coinbase; Alchemy RPC on Arbitrum.
 */
const walletConnectProjectId =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
      "14808831369ecdaaab7b8869eb13c6b0"
    : "14808831369ecdaaab7b8869eb13c6b0";

const appUrl =
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

export const wagmiConfig = createConfig({
  chains: [mainnet, arbitrum],
  connectors: [
    injected(),
    walletConnect({
      projectId: walletConnectProjectId,
      metadata: {
        name: "UpDown",
        description: "Prediction markets on Arbitrum",
        url: appUrl,
        icons: [],
      },
    }),
    coinbaseWallet({
      appName: "UpDown",
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(ALCHEMY_RPC_URL),
  },
  ssr: true,
});
