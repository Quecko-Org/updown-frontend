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
import { CookieConsentBanner } from "./CookieConsentBanner";
import { Footer } from "./Footer";
import { GeoBlockOverlay } from "./GeoBlockOverlay";
import { Header } from "./Header";
import { SubNav } from "./SubNav";
import { QuickMarketsStrip } from "./QuickMarketsStrip";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useGeoCheck } from "@/hooks/useGeoCheck";
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

  // Resolve visitor country once on mount; the result lives in geoStateAtom
  // and gates wallet-connect + trade-submit. Lookup runs in parallel with
  // every other startup work so it doesn't add to TTFB.
  useGeoCheck();

  // Analytics — consent-gated PostHog init + per-route page_view.
  useAnalytics();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <SubNav />
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
      <GeoBlockOverlay />
      <CookieConsentBanner />
    </div>
  );
}
