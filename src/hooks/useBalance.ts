"use client";

import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { createPublicClient, http, formatUnits } from "viem";
import { arbitrum } from "viem/chains";
import { erc20Abi } from "@/utils/erc20Abi";
import { usdt_token, ALCHEMY_RPC_URL } from "@/config/environment";
import { userSmartAccount } from "@/store/atoms";

const USDT_DECIMALS = 6;

const publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(ALCHEMY_RPC_URL),
});

/**
 * Reads USDT balance of the smart account directly from the ERC20 contract.
 * Mirrors speed-market `useGetUsdtBalance`. Polls every 10s while mounted.
 */
export function useGetUsdtBalance(refetchMs = 10_000) {
  const smartAccount = useAtomValue(userSmartAccount);
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!smartAccount) {
      setBalance(0);
      return;
    }

    let cancelled = false;

    const fetchBalance = async () => {
      try {
        setIsLoading(true);
        const raw = await publicClient.readContract({
          address: usdt_token as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [smartAccount as `0x${string}`],
        });
        if (cancelled) return;
        const formatted = Number(formatUnits(raw, USDT_DECIMALS));
        setBalance(Number.isFinite(formatted) ? formatted : 0);
      } catch (error) {
        if (!cancelled) {
          console.error("Error reading USDT balance:", error);
          setBalance(0);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void fetchBalance();
    const interval = setInterval(() => void fetchBalance(), refetchMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [smartAccount, refetchMs]);

  return { balance, isLoading };
}
