"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import { getConfig, getMarket, postOrder } from "@/lib/api";
import { buildOrderTypedData } from "@/lib/eip712";
import { parseUsdtToAtomic, formatUsdt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";

const PRESETS = [5, 25, 50, 100, 500];

export function TradeForm({ marketAddress }: { marketAddress: string }) {
  const { address, isConnected } = useAccount();
  const [side, setSide] = useState<1 | 2>(1);
  const [dollars, setDollars] = useState(25);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const qc = useQueryClient();

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
  });

  const { data: market } = useQuery({
    queryKey: ["market", marketAddress.toLowerCase()],
    queryFn: () => getMarket(marketAddress),
    refetchInterval: 15_000,
  });

  const { signTypedDataAsync } = useSignTypedData();

  const feeBps = (cfg?.platformFeeBps ?? 70) + (cfg?.makerFeeBps ?? 80);

  const limitPrice = useMemo(() => {
    if (!market || orderType === "MARKET") return 5000;
    const ob = side === 1 ? market.orderBook.up : market.orderBook.down;
    const ask = ob.bestAsk?.price;
    const bid = ob.bestBid?.price;
    if (side === 1) {
      // BUY: pay up to best ask or mid
      if (ask) return Math.min(9999, ask + 50);
      if (bid) return Math.min(9999, bid + 100);
    } else {
      if (bid) return Math.max(1, bid - 50);
      if (ask) return Math.max(1, ask - 100);
    }
    return 5000;
  }, [market, orderType, side]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!address || !cfg) throw new Error("Connect wallet");
      if (!market || market.status !== "ACTIVE") throw new Error("Market not active");
      const amount = parseUsdtToAtomic(String(dollars));
      const min = parseUsdtToAtomic("5");
      const max = parseUsdtToAtomic("500");
      if (amount < min || amount > max) throw new Error("Amount must be $5–$500");

      const nonce = Math.floor(Math.random() * 1e12);
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const typeNum = orderType === "MARKET" ? 1 : 0;
      const priceNum = orderType === "MARKET" ? 0 : limitPrice;

      const msg = {
        maker: address as `0x${string}`,
        market: marketAddress as `0x${string}`,
        option: BigInt(side),
        side: 0,
        type: typeNum,
        price: BigInt(priceNum),
        amount,
        nonce: BigInt(nonce),
        expiry: BigInt(expiry),
      };

      const typed = buildOrderTypedData(cfg, msg);
      const signature = await signTypedDataAsync(typed);

      await postOrder({
        maker: address,
        market: marketAddress,
        option: side,
        side: 0,
        type: orderType === "MARKET" ? "MARKET" : "LIMIT",
        price: orderType === "MARKET" ? 0 : priceNum,
        amount: amount.toString(),
        nonce,
        expiry,
        signature,
      });
    },
    onSuccess: () => {
      toast.success("Order submitted");
      qc.invalidateQueries({ queryKey: ["positions", address?.toLowerCase()] });
      qc.invalidateQueries({ queryKey: ["balance", address?.toLowerCase()] });
      qc.invalidateQueries({ queryKey: ["orderbook", marketAddress.toLowerCase()] });
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!isConnected) {
    return (
      <EmptyState
        icon="wallet"
        title="Connect a wallet"
        subtitle="Connect with MetaMask or another wallet to place signed UP / DOWN orders on this market."
      />
    );
  }

  return (
    <div className="card-kraken p-5">
      <h3 className="font-display text-lg font-bold text-foreground">Trade</h3>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-[12px] py-3 text-sm font-semibold transition-colors",
            side === 1
              ? "bg-success text-white shadow-sm"
              : "bg-surface-muted text-foreground hover:bg-success-soft"
          )}
          onClick={() => setSide(1)}
        >
          UP
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-[12px] py-3 text-sm font-semibold transition-colors",
            side === 2
              ? "bg-down text-white shadow-sm"
              : "bg-surface-muted text-foreground hover:bg-down-soft"
          )}
          onClick={() => setSide(2)}
        >
          DOWN
        </button>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-[12px] py-2 text-sm font-medium",
            orderType === "MARKET" ? "bg-brand-subtle text-brand" : "text-muted"
          )}
          onClick={() => setOrderType("MARKET")}
        >
          Market
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-[12px] py-2 text-sm font-medium",
            orderType === "LIMIT" ? "bg-brand-subtle text-brand" : "text-muted"
          )}
          onClick={() => setOrderType("LIMIT")}
        >
          Limit
        </button>
      </div>
      <div className="mt-4">
        <label className="text-xs font-medium text-muted">Size (USDT)</label>
        <input
          type="range"
          min={5}
          max={500}
          step={1}
          value={dollars}
          onChange={(e) => setDollars(Number(e.target.value))}
          className="mt-1 w-full accent-brand"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="rounded-[12px] border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-brand hover:text-brand"
              onClick={() => setDollars(p)}
            >
              ${p}
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-lg font-bold text-foreground">${dollars}</p>
      </div>
      <p className="mt-2 text-xs text-muted">
        Fees ~{(feeBps / 100).toFixed(2)}% total ({cfg?.platformFeeBps ?? 70} + {cfg?.makerFeeBps ?? 80}{" "}
        bps). Notional: <span className="font-medium text-foreground">${formatUsdt(parseUsdtToAtomic(String(dollars)))}</span>
      </p>
      {orderType === "LIMIT" && (
        <p className="mt-1 text-xs text-muted">
          Limit price (BPS): <span className="font-mono text-foreground">{limitPrice}</span>
        </p>
      )}
      <button
        type="button"
        disabled={submit.isPending || market?.status !== "ACTIVE"}
        className="btn-primary mt-4 w-full disabled:opacity-50"
        onClick={() => submit.mutate()}
      >
        {submit.isPending ? "Signing…" : `Buy ${side === 1 ? "UP" : "DOWN"}`}
      </button>
    </div>
  );
}
