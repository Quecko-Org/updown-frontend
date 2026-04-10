import { useConnectors, type Connector } from "wagmi";
import { WALLET_ORDER } from "@/config/walletConstants";

export interface WalletItem {
  name: string;
  connector: Connector | undefined;
  isAvailable: boolean;
}

export function useWalletList(): WalletItem[] {
  const connectors = useConnectors();

  return WALLET_ORDER.map((walletName) => {
    const connector = connectors.find((c) =>
      c.name?.toLowerCase()?.includes(walletName.toLowerCase())
    );
    return {
      name: walletName,
      connector,
      isAvailable: !!connector,
    };
  });
}
