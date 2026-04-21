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
        <h1 className="pp-h1">Fees</h1>
        <p className="pp-body mt-2 max-w-2xl" style={{ color: "var(--fg-2)" }}>
          PulsePairs charges platform and maker fees on matched volume. Under probability-weighted fees, the effective
          rate scales with share price:{" "}
          <span style={{ color: "var(--fg-0)", fontWeight: 500 }}>
            fees peak at {(peakBps / 100).toFixed(2)}% near a 50/50 market
          </span>{" "}
          and taper toward near zero at extremes (10¢, 90¢). Weight = 4 × price × (1 − price) in fraction form.
        </p>
      </div>

      <section
        className="pp-panel space-y-3"
        style={{ padding: "16px" }}
      >
        <h2 className="pp-h2">Effective fee examples</h2>
        <p className="pp-caption">
          Combined platform ({platform} bps) + maker ({maker} bps) = {totalBps} bps before weighting. Values below are
          effective bps after the probability weight.
        </p>
        <div className="overflow-x-auto">
          <table className="pp-table min-w-[280px]" style={{ width: "auto", maxWidth: 520 }}>
            <colgroup>
              <col style={{ width: 140 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 180 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Share price</th>
                <th className="r">Effective fee (bps)</th>
                <th className="r">On $100 trade</th>
              </tr>
            </thead>
            <tbody>
              {TABLE_CENTS.map((cents) => {
                const priceBps = cents * 100;
                const eff = effectiveFeeBpsAtSharePrice(totalBps, priceBps);
                const feeUsd = (100 * eff) / 10_000;
                return (
                  <tr key={cents}>
                    <td className="pp-tabular" style={{ color: "var(--fg-0)" }}>
                      {formatShareCentsLabel(priceBps)}
                    </td>
                    <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                      {eff}
                    </td>
                    <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                      ${feeUsd.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="pp-hash" style={{ color: "var(--fg-2)" }}>
          Live values: GET /config (feeModel, peakFeeBps).
        </p>
      </section>

      <section className="pp-panel space-y-3" style={{ padding: "16px" }}>
        <h2 className="pp-h2">Designated market makers</h2>
        <p className="pp-body" style={{ color: "var(--fg-2)" }}>
          Market makers who meet program requirements earn rebates on filled maker volume. Rebates are shown in the
          trade form when your wallet is approved.
        </p>
        <p>
          <Link
            href="/rebates"
            className="hover:underline"
            style={{ color: "var(--fg-0)", fontWeight: 500 }}
          >
            Rebates dashboard →
          </Link>
        </p>
      </section>

      <section className="pp-panel space-y-3" style={{ padding: "16px" }}>
        <h2 className="pp-h2">Order types</h2>
        <dl className="space-y-3">
          <div>
            <dt className="pp-body-strong">LIMIT</dt>
            <dd className="pp-body mt-0.5" style={{ color: "var(--fg-2)" }}>
              Rests on the book at your price (basis points).
            </dd>
          </div>
          <div>
            <dt className="pp-body-strong">MARKET</dt>
            <dd className="pp-body mt-0.5" style={{ color: "var(--fg-2)" }}>
              Matches immediately against the best available liquidity.
            </dd>
          </div>
          <div>
            <dt className="pp-body-strong">POST-ONLY</dt>
            <dd className="pp-body mt-0.5" style={{ color: "var(--fg-2)" }}>
              Maker-only. Rejected if it would cross and fill immediately.
            </dd>
          </div>
          <div>
            <dt className="pp-body-strong">IOC</dt>
            <dd className="pp-body mt-0.5" style={{ color: "var(--fg-2)" }}>
              Fills what is available now. Remainder cancels.
            </dd>
          </div>
        </dl>
      </section>

      <p className="pp-caption">
        <Link href="/" className="hover:underline" style={{ color: "var(--fg-0)" }}>
          ← Markets
        </Link>
      </p>
    </div>
  );
}
