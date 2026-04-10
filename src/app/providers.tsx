"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { Provider as JotaiProvider } from "jotai";
import { useState } from "react";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import { WalletProvider } from "@/context/WalletContext";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <JotaiProvider>
          <WalletProvider>
            {children}
            <Toaster position="top-center" richColors />
          </WalletProvider>
        </JotaiProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
