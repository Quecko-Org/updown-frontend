"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import Link from "next/link";
import { toast } from "sonner";
import {
  getMarket,
  getMarkets,
  getOrders,
  getPositions,
  postMarketClaim,
  type OrderRow,
  type PositionRow,
} from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import { marketPathFromAddress } from "@/lib/marketKey";
import {
  formatMarketWindow,
  isResolvedMarketStatus,
  isTerminalMarketStatus,
} from "@/lib/derivations";
import { userSmartAccount } from "@/store/atoms";

/**
 * Phase2-A consolidation: replaces /positions + /history with a single
 * tabbed surface. Tab state lives in the URL (?tab=active|resolved) so
 * deep links stay functional.
 *
 *   Active tab    → open positions (markets still trading) + open orders
 *   Resolved tab  → settled positions with outcome + filled trades
 *
 * The summary card across the top reduces from "what does the user have?"
 * to four numbers: total invested, realized P&L, win rate, active stakes
 * count. All four are derived client-side from the positions feed; backend
 * gets no new endpoint in this PR.
 */

function shortenMarket(addr: string): string {
  if (addr.length <= 22) return addr;
  return `${addr.slice(0, 12)}…${addr.slice(-8)}`;
}

function statusChipClass(status: string): string {
  if (status === "FILLED") return "pp-chip-status pp-chip-status--filled";
  if (status === "CANCELLED") return "pp-chip-status pp-chip-status--cancelled";
  if (status === "OPEN") return "pp-chip-status pp-chip-status--open";
  if (status === "PARTIALLY_FILLED") return "pp-chip-status pp-chip-status--partial";
  return "pp-chip-status pp-chip-status--open";
}

type Tab = "active" | "resolved";

function readTab(sp: URLSearchParams | null): Tab {
  return sp?.get("tab") === "resolved" ? "resolved" : "active";
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="pp-caption text-center py-8">Loading…</div>}>
      <PortfolioInner />
    </Suspense>
  );
}

function PortfolioInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = readTab(sp);
  const { address, isConnected } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const qc = useQueryClient();

  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ["positions", smartAccount?.toLowerCase() ?? ""],
    queryFn: () => getPositions(smartAccount!),
    enabled: !!smartAccount && isConnected,
    refetchInterval: 20_000,
    retry: 1,
  });

  const addrLower = address?.toLowerCase() ?? "";
  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () => getOrders(address!, { limit: 50 }),
    enabled: !!address && isConnected,
    retry: 1,
    staleTime: 10_000,
  });
  const orders: OrderRow[] = ordersResp?.orders ?? [];

  // Markets snapshot — used to gate the per-row Cancel button on the
  // Active tab. Cancels on closed markets are rejected by the backend
  // (post-Path-1 PR #54), but exposing the button still implies the
  // trade is reversible after the user already lost. Fail-safe: if the
  // market isn't in the cached list (closed markets often drop off),
  // treat it as non-ACTIVE and hide the button. Reuses the cached
  // `["markets"]` query so the network cost is shared with the rest of
  // the app.
  const { data: marketsList } = useQuery({
    queryKey: ["markets"],
    queryFn: () => getMarkets(),
    enabled: isConnected,
    staleTime: 30_000,
  });
  const marketStatusByAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of marketsList ?? []) map.set(m.address.toLowerCase(), m.status);
    return map;
  }, [marketsList]);

  // Resolved-position winner lookup so we can compute realized P&L without
  // a backend trade-aggregation endpoint. Mirrors the per-market query
  // pattern previously used in the History page.
  const resolvedMarketKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of positions ?? []) {
      if (isResolvedMarketStatus(p.marketStatus)) set.add(p.market.toLowerCase());
    }
    return Array.from(set);
  }, [positions]);

  const marketQueries = useQueries({
    queries: resolvedMarketKeys.map((m) => ({
      queryKey: ["market", m],
      queryFn: () => getMarket(m),
      staleTime: 60_000,
    })),
  });

  const winnerByMarket = useMemo(() => {
    const map = new Map<string, number | null>();
    resolvedMarketKeys.forEach((m, i) => {
      map.set(m, marketQueries[i]?.data?.winner ?? null);
    });
    return map;
  }, [resolvedMarketKeys, marketQueries]);

  // F3: market-window label per resolved market. Lets users
  // disambiguate "which 5-min BTC market did I trade?" at a glance.
  const windowByMarket = useMemo(() => {
    const map = new Map<string, string | null>();
    resolvedMarketKeys.forEach((m, i) => {
      const d = marketQueries[i]?.data;
      map.set(m, d ? formatMarketWindow(d) : null);
    });
    return map;
  }, [resolvedMarketKeys, marketQueries]);

  const summary = useMemo(() => computeSummary(positions ?? [], winnerByMarket), [positions, winnerByMarket]);

  const claim = useMutation({
    mutationFn: (market: string) => postMarketClaim(market),
    onSuccess: () => {
      toast.success("Claim submitted");
      const sa = smartAccount?.toLowerCase() ?? "";
      qc.invalidateQueries({ queryKey: ["positions", sa] });
      qc.invalidateQueries({ queryKey: ["balance", addrLower] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setTab = (t: Tab) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (t === "active") params.delete("tab");
    else params.set("tab", t);
    const qs = params.toString();
    router.replace(qs ? `/portfolio?${qs}` : "/portfolio");
  };

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="pp-h1">Portfolio</h1>
          <p className="pp-caption mt-1">Open positions, orders, and resolved trades.</p>
        </div>
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Your active positions and trade history show here once connected."
        />
      </div>
    );
  }

  const activePositions = (positions ?? []).filter(
    (p) => !isTerminalMarketStatus(p.marketStatus),
  );
  const resolvedPositions = (positions ?? []).filter((p) =>
    isResolvedMarketStatus(p.marketStatus),
  );
  const openOrders = orders.filter(
    (o) => o.status === "OPEN" || o.status === "PARTIALLY_FILLED",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="pp-h1">Portfolio</h1>
        <p className="pp-caption mt-1">Open positions, orders, and resolved trades.</p>
      </div>

      <PortfolioSummary {...summary} />

      <div className="pp-tab" role="tablist" aria-label="Portfolio sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "active"}
          className={cn("pp-tab__btn", tab === "active" && "pp-tab__btn--on")}
          onClick={() => setTab("active")}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "resolved"}
          className={cn("pp-tab__btn", tab === "resolved" && "pp-tab__btn--on")}
          onClick={() => setTab("resolved")}
        >
          Resolved
        </button>
      </div>

      {tab === "active" ? (
        <ActiveTab
          loading={positionsLoading}
          positions={activePositions}
          openOrders={openOrders}
          marketStatusByAddress={marketStatusByAddress}
        />
      ) : (
        <ResolvedTab
          loading={positionsLoading}
          positions={resolvedPositions}
          winnerByMarket={winnerByMarket}
          windowByMarket={windowByMarket}
          onClaim={(m) => claim.mutate(m)}
          claimPending={claim.isPending}
        />
      )}
    </div>
  );
}

function computeSummary(
  positions: PositionRow[],
  winnerByMarket: Map<string, number | null>,
) {
  let invested = BigInt(0);
  let activeCount = 0;
  let realizedPnL = BigInt(0);
  let wins = 0;
  let losses = 0;

  for (const p of positions) {
    const cost = safeBigInt(p.costBasis);
    const shares = safeBigInt(p.shares);
    if (shares === BigInt(0)) continue;

    if (!isTerminalMarketStatus(p.marketStatus)) {
      invested += cost;
      activeCount += 1;
      continue;
    }

    if (isResolvedMarketStatus(p.marketStatus)) {
      const winner = winnerByMarket.get(p.market.toLowerCase()) ?? null;
      if (winner === 0 || winner == null) continue;
      if (p.option === winner) {
        // Winning side pays out 1 USDT per share. shares is in atomic USDT
        // (decimals match) so payout = shares; pnl = shares - cost.
        realizedPnL += shares - cost;
        wins += 1;
      } else {
        realizedPnL -= cost;
        losses += 1;
      }
    }
  }

  const totalResolved = wins + losses;
  const winRate = totalResolved === 0 ? null : Math.round((wins / totalResolved) * 100);

  return {
    invested: invested.toString(),
    activeCount,
    realizedPnL,
    winRate,
    totalResolved,
  };
}

function safeBigInt(s: string | undefined | null): bigint {
  try {
    return BigInt(s ?? "0");
  } catch {
    return BigInt(0);
  }
}

function PortfolioSummary({
  invested,
  activeCount,
  realizedPnL,
  winRate,
  totalResolved,
}: {
  invested: string;
  activeCount: number;
  realizedPnL: bigint;
  winRate: number | null;
  totalResolved: number;
}) {
  const pnlSign = realizedPnL >= BigInt(0) ? "+" : "−";
  const pnlAbs = realizedPnL >= BigInt(0) ? realizedPnL : -realizedPnL;
  const pnlColor = realizedPnL > BigInt(0) ? "var(--up)" : realizedPnL < BigInt(0) ? "var(--down)" : "var(--fg-1)";
  return (
    <div className="pp-statsrail">
      <div className="pp-statsrail__cell">
        <span className="pp-micro">Invested (active)</span>
        <span className="pp-price-xl">${formatUsdt(invested)}</span>
      </div>
      <div className="pp-statsrail__cell">
        <span className="pp-micro">Realized P&L</span>
        <span className="pp-price-xl" style={{ color: pnlColor }}>
          {totalResolved === 0 ? "—" : `${pnlSign}$${formatUsdt(pnlAbs.toString())}`}
        </span>
      </div>
      <div className="pp-statsrail__cell">
        <span className="pp-micro">Win rate</span>
        <span className="pp-price-xl">{winRate == null ? "—" : `${winRate}%`}</span>
      </div>
      <div className="pp-statsrail__cell">
        <span className="pp-micro">Active stakes</span>
        <span className="pp-price-xl">{activeCount}</span>
      </div>
    </div>
  );
}

function ActiveTab({
  loading,
  positions,
  openOrders,
  marketStatusByAddress,
}: {
  loading: boolean;
  positions: PositionRow[];
  openOrders: OrderRow[];
  marketStatusByAddress: Map<string, string>;
}) {
  if (loading) {
    return <div className="py-8 text-center pp-caption">Loading…</div>;
  }
  if (positions.length === 0 && openOrders.length === 0) {
    return (
      <EmptyState
        icon="trade"
        title="No active stakes"
        subtitle="Place a trade on a live market — your positions and open orders show here."
      />
    );
  }
  return (
    <div className="space-y-6">
      {positions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="pp-h3">Open positions</h2>
          <PositionTable positions={positions} mode="active" />
        </section>
      ) : null}
      {openOrders.length > 0 ? (
        <section className="space-y-3">
          <h2 className="pp-h3">Open orders</h2>
          <OrderTable orders={openOrders} marketStatusByAddress={marketStatusByAddress} />
        </section>
      ) : null}
    </div>
  );
}

function ResolvedTab({
  loading,
  positions,
  winnerByMarket,
  windowByMarket,
  onClaim,
  claimPending,
}: {
  loading: boolean;
  positions: PositionRow[];
  winnerByMarket: Map<string, number | null>;
  windowByMarket: Map<string, string | null>;
  onClaim: (market: string) => void;
  claimPending: boolean;
}) {
  if (loading) {
    return <div className="py-8 text-center pp-caption">Loading…</div>;
  }
  if (positions.length === 0) {
    return (
      <EmptyState
        icon="list"
        title="No resolved trades yet"
        subtitle="Once your markets close, the outcome and P&L show here."
      />
    );
  }

  return (
    <div
      className="overflow-hidden overflow-x-auto rounded-[6px] border"
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      <table className="pp-table min-w-full">
        <thead>
          <tr>
            <th>Market</th>
            <th className="hidden md:table-cell">Window</th>
            <th>Side</th>
            <th>Outcome</th>
            <th className="r">Shares</th>
            <th className="r">P&L</th>
            <th className="r">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const winner = winnerByMarket.get(p.market.toLowerCase()) ?? null;
            const windowLabel =
              windowByMarket.get(p.market.toLowerCase()) ?? null;
            const won = winner != null && winner !== 0 && p.option === winner;
            const lost = winner != null && winner !== 0 && p.option !== winner;
            const cost = safeBigInt(p.costBasis);
            const shares = safeBigInt(p.shares);
            const pnl = won ? shares - cost : lost ? -cost : BigInt(0);
            const pnlColor = pnl > BigInt(0) ? "var(--up)" : pnl < BigInt(0) ? "var(--down)" : "var(--fg-2)";
            const pnlAbs = pnl >= BigInt(0) ? pnl : -pnl;
            const claimable = p.marketStatus === "RESOLVED" && won;
            return (
              <tr key={`${p.market}-${p.option}`}>
                <td>
                  <Link
                    href={marketPathFromAddress(p.market)}
                    className="hover:underline"
                    style={{ color: "var(--fg-0)" }}
                  >
                    <span className="pp-hash">{shortenMarket(p.market)}</span>
                  </Link>
                </td>
                <td
                  className="hidden md:table-cell pp-tabular"
                  style={{ color: "var(--fg-2)", fontSize: 12 }}
                >
                  {windowLabel ?? (
                    <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
                      …
                    </span>
                  )}
                </td>
                <td>
                  <span className={cn(p.option === 1 ? "pp-chip-up" : "pp-chip-down")}>
                    {p.optionLabel}
                  </span>
                </td>
                <td>
                  {winner == null ? (
                    <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
                      Loading…
                    </span>
                  ) : won ? (
                    <span className="pp-chip-status pp-chip-status--filled">Won</span>
                  ) : lost ? (
                    <span className="pp-chip-status pp-chip-status--cancelled">Lost</span>
                  ) : (
                    <span className="pp-caption">—</span>
                  )}
                </td>
                <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                  ${formatUsdt(p.shares)}
                </td>
                <td className="r pp-tabular" style={{ color: pnlColor }}>
                  {winner == null
                    ? "—"
                    : `${pnl >= BigInt(0) ? "+" : "−"}$${formatUsdt(pnlAbs.toString())}`}
                </td>
                <td className="r">
                  {p.marketStatus === "CLAIMED" ? (
                    <span className="pp-chip-status pp-chip-status--filled">Auto-claimed</span>
                  ) : claimable ? (
                    <button
                      type="button"
                      className="pp-btn pp-btn--secondary pp-btn--sm"
                      disabled={claimPending}
                      onClick={() => onClaim(p.market)}
                      title="Nudge the relayer to credit winnings."
                    >
                      Claim
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionTable({
  positions,
  mode,
}: {
  positions: PositionRow[];
  mode: "active" | "resolved";
}) {
  return (
    <div
      className="overflow-hidden overflow-x-auto rounded-[6px] border"
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      <table className="pp-table min-w-full">
        <thead>
          <tr>
            <th>Market</th>
            <th>Side</th>
            <th className="r">Shares</th>
            <th className="r">Avg price</th>
            {mode === "active" ? <th>Status</th> : null}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={`${p.market}-${p.option}`}>
              <td>
                <Link
                  href={marketPathFromAddress(p.market)}
                  className="hover:underline"
                  style={{ color: "var(--fg-0)" }}
                >
                  <span className="pp-hash">{shortenMarket(p.market)}</span>
                </Link>
              </td>
              <td>
                <span className={cn(p.option === 1 ? "pp-chip-up" : "pp-chip-down")}>
                  {p.optionLabel}
                </span>
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                ${formatUsdt(p.shares)}
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-2)" }}>
                {p.avgPrice} bps
              </td>
              {mode === "active" ? (
                <td>
                  <span className="pp-chip-status pp-chip-status--open">{p.marketStatus}</span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({
  orders,
  marketStatusByAddress,
}: {
  orders: OrderRow[];
  marketStatusByAddress: Map<string, string>;
}) {
  return (
    <div
      className="overflow-hidden overflow-x-auto rounded-[6px] border"
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      <table className="pp-table min-w-full">
        <thead>
          <tr>
            <th>Market</th>
            <th>Dir</th>
            <th>Side</th>
            <th className="r">Amount</th>
            <th className="r hidden sm:table-cell">Price</th>
            <th>Status</th>
            <th className="r">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderId}>
              <td>
                <Link
                  href={marketPathFromAddress(o.market)}
                  className="hover:underline"
                  style={{ color: "var(--fg-0)" }}
                >
                  <span className="pp-hash">{shortenMarket(o.market)}</span>
                </Link>
              </td>
              <td>
                <span className={o.option === 1 ? "pp-chip-up" : "pp-chip-down"}>
                  {o.option === 1 ? "UP" : "DOWN"}
                </span>
              </td>
              <td>
                <span className="pp-micro" style={{ color: "var(--fg-0)" }}>
                  {o.side === 0 ? "BUY" : "SELL"}
                </span>
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                ${formatUsdt(o.amount)}
              </td>
              <td className="r pp-tabular hidden sm:table-cell" style={{ color: "var(--fg-0)" }}>
                {o.type === 1 ? "MKT" : `${(o.price / 100).toFixed(0)}¢`}
              </td>
              <td>
                <span className={statusChipClass(o.status)}>{o.status}</span>
              </td>
              <td className="r">
                {(o.status === "OPEN" || o.status === "PARTIALLY_FILLED") &&
                marketStatusByAddress.get(o.market.toLowerCase()) === "ACTIVE" ? (
                  <CancelOrderButton orderId={o.orderId} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
