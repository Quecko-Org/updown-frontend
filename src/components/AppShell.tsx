"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useAccount } from "wagmi";
import { getConfig } from "@/lib/api";
import { apiConfigAtom } from "@/store/atoms";
import { useUpDownWebSocket } from "@/hooks/useUpDownWebSocket";
import { useLivePriceFeed } from "@/hooks/useLivePriceFeed";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { QuickMarketsStrip } from "./QuickMarketsStrip";
import { cn } from "@/lib/cn";

const LIVE_SYMBOLS = ["BTC", "ETH"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketPage = pathname?.startsWith("/market/");
  const marketMatch = pathname?.match(/^\/market\/(.+)$/);
  const marketFromRoute = marketMatch?.[1] ? decodeURIComponent(marketMatch[1]) : null;

  const { address } = useAccount();
  const setApiConfig = useSetAtom(apiConfigAtom);

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (cfg) setApiConfig(cfg);
  }, [cfg, setApiConfig]);

  useUpDownWebSocket({
    wallet: address ?? null,
    marketAddress: marketFromRoute,
    enabled: true,
  });

  // Binance WebSocket for real-time BTC/ETH prices → updates chart cache every 1s
  useLivePriceFeed(LIVE_SYMBOLS);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <QuickMarketsStrip />
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-8",
          isMarketPage ? "max-w-[1440px]" : "max-w-[1280px]",
        )}
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}
