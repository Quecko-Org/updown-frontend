"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { getConfig } from "@/lib/api";
import { apiConfigAtom, userSmartAccount } from "@/store/atoms";
import { useUpDownWebSocket } from "@/hooks/useUpDownWebSocket";
import { Header } from "./Header";
import { cn } from "@/lib/cn";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketPage = pathname?.startsWith("/market/");
  const marketMatch = pathname?.match(/^\/market\/(.+)$/);
  const marketFromRoute = marketMatch?.[1] ? decodeURIComponent(marketMatch[1]) : null;

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

  useUpDownWebSocket({
    wallet: smartAccount || null,
    marketAddress: marketFromRoute,
    enabled: true,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main
        className={cn(
          "mx-auto w-full px-4 pb-12 pt-4 sm:px-6 lg:px-8",
          isMarketPage ? "max-w-7xl" : "max-w-6xl",
        )}
      >
        {children}
      </main>
    </div>
  );
}
