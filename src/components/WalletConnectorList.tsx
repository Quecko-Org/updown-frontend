"use client";

import type { Connector } from "wagmi";
import { useWalletContext } from "@/context/WalletContext";
import { useWalletList } from "@/hooks/useWalletList";
import { cn } from "@/lib/cn";

type WalletConnectorListProps = {
  /** Called after a connector is chosen (e.g. close parent dropdown). */
  onPick?: () => void;
  className?: string;
  buttonClassName?: string;
};

export function WalletConnectorList({
  onPick,
  className,
  buttonClassName,
}: WalletConnectorListProps) {
  const { connectWallet, isLoading } = useWalletContext();
  const walletList = useWalletList();

  async function pick(connector: Connector | undefined) {
    if (!connector) return;
    await connectWallet(connector);
    onPick?.();
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {walletList.map(({ name, connector, isAvailable }) => (
        <button
          key={name}
          type="button"
          disabled={!isAvailable || !connector || isLoading}
          className={cn(
            "w-full rounded-[12px] px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50",
            buttonClassName,
          )}
          onClick={() => void pick(connector)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
