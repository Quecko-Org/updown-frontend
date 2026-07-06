"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { getConfig } from "@/lib/api";
import { apiConfigAtom, userSmartAccount } from "@/store/atoms";
import { useUpDownWebSocket } from "@/hooks/useUpDownWebSocket";
import { useLivePriceFeed } from "@/hooks/useLivePriceFeed";
import { CookieConsentBanner } from "./CookieConsentBanner";
import { Footer } from "./Footer";
import { GeoBlockOverlay } from "./GeoBlockOverlay";
import { Header } from "./Header";
import { SubNav } from "./SubNav";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useGeoCheck } from "@/hooks/useGeoCheck";

const LIVE_SYMBOLS = ["BTC", "ETH"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const smartAccount = useAtomValue(userSmartAccount);
  const setApiConfig = useSetAtom(apiConfigAtom);

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (cfg) setApiConfig(cfg);
  }, [cfg, setApiConfig]);

  // PR-R (2026-05-20): the deprecated /market/<address> route is gone;
  // there's no route-derived marketAddress to scope the per-market WS
  // subscription. Home page drawer is the single trade surface and
  // manages its own per-market subscriptions inside the drawer
  // component.
  // Account Kit: private channels are keyed by the SCA (the trading
  // identity backend rows live under), not the owner EOA.
  useUpDownWebSocket({
    wallet: smartAccount || null,
    marketAddress: null,
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
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Footer />
      <GeoBlockOverlay />
      <CookieConsentBanner />
    </div>
  );
}
