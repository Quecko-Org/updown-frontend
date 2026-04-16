"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@/lib/api";
import { effectiveFeeBpsAtSharePrice, formatShareCentsLabel } from "@/lib/feeEstimate";

const TABLE_CENTS = [50, 30, 70, 10, 90] as const;

export default function FeesPage() {
  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
  });

  const platform = cfg?.platformFeeBps ?? 70;
  const maker = cfg?.makerFeeBps ?? 80;
  const totalBps = platform + maker;
  const peakBps = cfg?.peakFeeBps ?? totalBps;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Fees</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          PulsePairs charges platform and maker fees on matched volume. When the protocol uses{" "}
          <span className="font-semibold text-foreground">probability-weighted</span> fees (same model as Polymarket),
          the effective rate scales with the share price:{" "}
          <span className="font-semibold text-foreground">
            fees peak at {(peakBps / 100).toFixed(2)}% near a 50/50 market
          </span>{" "}
          and taper toward <span className="font-semibold text-foreground">near zero</span> at extreme prices (e.g. 10¢
          or 90¢), because weight = 4 × price × (1 − price) in fraction form.
        </p>
      </div>

      <section className="panel-dense space-y-3 p-4">
        <h2 className="text-sm font-bold text-foreground">Effective fee examples</h2>
        <p className="text-xs text-muted">
          Combined platform ({platform} bps) + maker ({maker} bps) = {totalBps} bps before weighting. Values below are
          effective bps after the probability weight (integer math, aligned with backend).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-3 font-semibold">Share price</th>
                <th className="py-2 pr-3 font-semibold">Effective fee (bps)</th>
                <th className="py-2 font-semibold">On $100 trade</th>
              </tr>
            </thead>
            <tbody className="font-mono text-foreground">
              {TABLE_CENTS.map((cents) => {
                const priceBps = cents * 100;
                const eff = effectiveFeeBpsAtSharePrice(totalBps, priceBps);
                const feeUsd = (100 * eff) / 10_000;
                return (
                  <tr key={cents} className="border-b border-border/70">
                    <td className="py-1.5 pr-3">{formatShareCentsLabel(priceBps)}</td>
                    <td className="py-1.5 pr-3">{eff}</td>
                    <td className="py-1.5">${feeUsd.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted">
          Live values: <code className="rounded bg-surface-muted px-1">GET /config</code> (
          <code className="rounded bg-surface-muted px-1">feeModel</code>,{" "}
          <code className="rounded bg-surface-muted px-1">peakFeeBps</code>).
        </p>
      </section>

      <section className="panel-dense space-y-3 p-4">
        <h2 className="text-sm font-bold text-foreground">Designated market makers (DMM)</h2>
        <p className="text-xs leading-relaxed text-muted">
          Market makers who meet program requirements can earn rebates on filled maker volume. Rebates are shown in the
          trade form when your wallet is approved.
        </p>
        <p className="text-xs">
          <Link href="/rebates" className="font-semibold text-brand hover:underline">
            Rebates dashboard →
          </Link>
        </p>
      </section>

      <section className="panel-dense space-y-3 p-4">
        <h2 className="text-sm font-bold text-foreground">Order types</h2>
        <dl className="space-y-3 text-xs">
          <div>
            <dt className="font-semibold text-foreground">LIMIT</dt>
            <dd className="mt-0.5 text-muted">Rests on the book at your price (basis points).</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">MARKET</dt>
            <dd className="mt-0.5 text-muted">Matches immediately against the best available liquidity.</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">POST_ONLY</dt>
            <dd className="mt-0.5 text-muted">Maker-only: rejected if it would cross and fill immediately.</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">IOC</dt>
            <dd className="mt-0.5 text-muted">Fills now; remainder canceled.</dd>
          </div>
        </dl>
      </section>

      <p className="text-xs text-muted">
        <Link href="/" className="font-semibold text-brand hover:underline">
          ← Markets
        </Link>
      </p>
    </div>
  );
}
