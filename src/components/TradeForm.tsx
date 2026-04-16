"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import {
  getConfig,
  getMarket,
  getDmmStatus,
  postOrder,
  ORDER_TYPE_U8,
  type OrderApiType,
} from "@/lib/api";
import { buildOrderTypedData } from "@/lib/eip712";
import { parseUsdtToAtomic } from "@/lib/format";
import {
  estimateTotalFee,
  formatShareCentsLabel,
  impliedProbabilityForSide,
  sharePriceBpsFromOrderBookMid,
} from "@/lib/feeEstimate";
import { approxProfitIfSideWinsUsd } from "@/lib/payoutEstimate";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { apiConfigAtom, sessionReadyAtom, userSmartAccount } from "@/store/atoms";

const PRESETS = [5, 25, 50, 100, 500];

const ORDER_TYPES: { id: OrderApiType; label: string; tooltip?: string }[] = [
  { id: "LIMIT", label: "Limit" },
  { id: "MARKET", label: "Market" },
  {
    id: "POST_ONLY",
    label: "Post-only",
    tooltip:
      "Your order will only rest on the book. If it would fill immediately, it's rejected.",
  },
  {
    id: "IOC",
    label: "IOC",
    tooltip: "Fill what's available now, cancel the remainder.",
  },
];

function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex align-middle" title={text}>
      <span className="sr-only">{text}</span>
      <svg
        className="ml-0.5 inline h-3.5 w-3.5 text-muted"
        viewBox="0 0 12 12"
        fill="currentColor"
        aria-hidden
      >
        <path d="M6 0a6 6 0 100 12A6 6 0 006 0zm.75 9H5.25V5.25h1.5V9zm0-5.25H5.25v-1h1.5v1z" />
      </svg>
    </span>
  );
}

export function TradeForm({ marketAddress }: { marketAddress: string }) {
  const { address, isConnected } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const sessionReady = useAtomValue(sessionReadyAtom);
  const apiConfig = useAtomValue(apiConfigAtom);
  const [side, setSide] = useState<1 | 2>(1);
  const [dollars, setDollars] = useState(25);
  const [orderType, setOrderType] = useState<OrderApiType>("LIMIT");
  const qc = useQueryClient();
  const connectSectionRef = useRef<HTMLDivElement>(null);

  function scrollToConnect() {
    connectSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const parsedKey = useMemo(() => parseCompositeMarketKey(marketAddress), [marketAddress]);

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
  });

  const marketKey = parsedKey?.composite ?? marketAddress;

  const { data: market } = useQuery({
    queryKey: ["market", marketKey.toLowerCase()],
    queryFn: () => getMarket(marketKey),
    enabled: !!parsedKey,
    refetchInterval: 15_000,
  });

  const { data: dmmStatus } = useQuery({
    queryKey: ["dmmStatus", address?.toLowerCase() ?? ""],
    queryFn: () => getDmmStatus(address!),
    enabled: !!address && isConnected,
    staleTime: 60_000,
  });

  const { signTypedDataAsync } = useSignTypedData();

  const totalBps = (cfg?.platformFeeBps ?? 70) + (cfg?.makerFeeBps ?? 80);

  const limitPrice = useMemo(() => {
    if (!market || orderType === "MARKET") return 5000;
    const ob = side === 1 ? market.orderBook.up : market.orderBook.down;
    const ask = ob.bestAsk?.price;
    const bid = ob.bestBid?.price;
    if (side === 1) {
      if (ask) return Math.min(9999, ask + 50);
      if (bid) return Math.min(9999, bid + 100);
    } else {
      if (bid) return Math.max(1, bid - 50);
      if (ask) return Math.max(1, ask - 100);
    }
    return 5000;
  }, [market, orderType, side]);

  const impliedP =
    market != null ? impliedProbabilityForSide(side, market.upPrice, market.downPrice) : 0.5;

  const sharePriceBps = useMemo(() => {
    if (!market) return 5000;
    return sharePriceBpsFromOrderBookMid(side, market.orderBook);
  }, [market, side]);

  const { feeUsd: feeUsdDisplay, effectivePercentOfNotional } = estimateTotalFee(
    Number(dollars),
    totalBps,
    sharePriceBps,
    cfg?.feeModel,
  );
  const shareCentsLabel = formatShareCentsLabel(sharePriceBps);
  const peakFeeBps = cfg?.peakFeeBps ?? totalBps;
  const peakFeePct = (peakFeeBps / 100).toFixed(2);

  const payoutIfWin = approxProfitIfSideWinsUsd(Number(dollars), impliedP, totalBps, {
    feeModel: cfg?.feeModel,
    sharePriceBps,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!address || !cfg || !parsedKey) throw new Error("Connect wallet");
      if (!market || market.status !== "ACTIVE") throw new Error("Market not active");
      const amount = parseUsdtToAtomic(String(dollars));
      const min = parseUsdtToAtomic("5");
      const max = parseUsdtToAtomic("500");
      if (amount < min || amount > max) throw new Error("Amount must be $5–$500");

      const nonce = Math.floor(Math.random() * 1e12);
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const typeNum = ORDER_TYPE_U8[orderType];
      const priceNum = orderType === "MARKET" ? 0 : limitPrice;

      const msg = {
        maker: address as `0x${string}`,
        market: parsedKey.marketId,
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
        market: parsedKey.composite,
        option: side,
        side: 0,
        type: typeNum,
        price: orderType === "MARKET" ? 0 : priceNum,
        amount: amount.toString(),
        nonce,
        expiry,
        signature,
      });
    },
    onSuccess: () => {
      toast.success("Order submitted");
      const sa = smartAccount?.toLowerCase() ?? "";
      qc.invalidateQueries({ queryKey: ["positions", sa] });
      qc.invalidateQueries({ queryKey: ["balance", address?.toLowerCase() ?? ""] });
      qc.invalidateQueries({ queryKey: ["orderbook", marketKey.toLowerCase()] });
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!parsedKey) {
    return (
      <EmptyState
        icon="chart"
        title="Invalid market link"
        subtitle="This URL does not match a valid market key (settlement address and market id)."
      />
    );
  }

  const rebateBps = dmmStatus?.isDmm ? apiConfig?.dmmRebateBps : undefined;

  return (
    <div className="panel-dense px-3 py-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Trade</h3>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-[10px] py-2.5 text-sm font-semibold transition-colors",
            side === 1
              ? "bg-success text-white shadow-sm"
              : "bg-surface-muted text-foreground hover:bg-success-soft"
          )}
          onClick={() => {
            setSide(1);
            if (!isConnected) scrollToConnect();
          }}
        >
          UP
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-[10px] py-2.5 text-sm font-semibold transition-colors",
            side === 2
              ? "bg-down text-white shadow-sm"
              : "bg-surface-muted text-foreground hover:bg-down-soft"
          )}
          onClick={() => {
            setSide(2);
            if (!isConnected) scrollToConnect();
          }}
        >
          DOWN
        </button>
      </div>
      <div className="mt-3">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Order type</p>
        <div className="flex flex-wrap gap-2">
          {ORDER_TYPES.map((ot) => (
            <button
              key={ot.id}
              type="button"
              title={ot.tooltip}
              className={cn(
                "inline-flex items-center rounded-[12px] px-3 py-2 text-xs font-semibold transition-colors",
                orderType === ot.id ? "bg-brand-subtle text-brand" : "text-muted hover:bg-surface-muted"
              )}
              onClick={() => setOrderType(ot.id)}
            >
              {ot.label}
              {ot.tooltip ? <InfoTip text={ot.tooltip} /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <label className="text-[10px] font-medium text-muted">Size (USDT)</label>
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
        <p className="mt-1 text-center text-base font-bold tabular-nums text-foreground">${dollars}</p>
      </div>
      <p className="mt-2 text-xs font-semibold text-foreground">
        If {side === 1 ? "UP" : "DOWN"} wins:{" "}
        <span className="text-success">+${payoutIfWin.toFixed(2)}</span>{" "}
        <span className="font-normal text-muted">(est., after fees)</span>
      </p>
      <div className="mt-1.5 space-y-1 text-[10px] text-muted">
        <p className="text-foreground">
          Fee:{" "}
          <span className="font-semibold">
            ${feeUsdDisplay.toFixed(2)} ({effectivePercentOfNotional.toFixed(2)}% at {shareCentsLabel})
          </span>{" "}
          <InfoTip
            text={`Peak fee: ${peakFeePct}% at 50¢ (combined platform + maker bps). Fees scale down toward 0¢ and 100¢ — same probability weight as Polymarket.`}
          />
        </p>
        <p className="text-muted">
          Peak fee {(peakFeeBps / 100).toFixed(2)}% at 50¢ — lower when the book is far from 50/50.
        </p>
        {rebateBps != null && rebateBps > 0 && (
          <p className="font-medium text-success-dark">
            You&apos;ll earn {(rebateBps / 100).toFixed(2)}% rebate on this fill
          </p>
        )}
      </div>
      {orderType !== "MARKET" && (
        <p className="mt-2 text-xs text-muted">
          Limit price (BPS): <span className="font-mono text-foreground">{limitPrice}</span>
        </p>
      )}
      {isConnected ? (
        <button
          type="button"
          disabled={submit.isPending || market?.status !== "ACTIVE" || !sessionReady}
          title={!sessionReady ? "Complete connection first" : undefined}
          className="btn-primary mt-3 w-full disabled:opacity-50"
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? "Signing…" : `Buy ${side === 1 ? "UP" : "DOWN"}`}
        </button>
      ) : (
        <div
          ref={connectSectionRef}
          className="mt-3 rounded-lg border border-border bg-surface-muted/30 p-3"
        >
          <p className="text-center text-sm font-bold text-foreground">Connect wallet to trade</p>
          <p className="mt-1 text-center text-xs text-muted">
            Choose a wallet to sign in. You can adjust side and size first.
          </p>
          <WalletConnectorList className="mt-3" />
        </div>
      )}
    </div>
  );
}
