"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useAccount } from "wagmi";
import { getConfig } from "@/lib/api";
import { apiConfigAtom } from "@/store/atoms";
import { useUpDownWebSocket } from "@/hooks/useUpDownWebSocket";
import { Header } from "./Header";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketMatch = pathname?.match(/^\/market\/(0x[a-fA-F0-9]{40})/i);
  const marketFromRoute = marketMatch?.[1] ?? null;

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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
