import { effectiveFeeBpsAtSharePrice } from "@/lib/feeEstimate";

export type PayoutFeeOpts = {
  feeModel?: string;
  /** Share price in bps (1–9999) for the bought side; drives probability-weighted fee. */
  sharePriceBps?: number;
};

/** Rough profit if the chosen side wins (binary-style), after notional fee haircut. */
export function approxProfitIfSideWinsUsd(
  stakeUsd: number,
  impliedProbSide: number,
  totalFeeBps: number,
  opts?: PayoutFeeOpts,
): number {
  if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) return 0;
  const p = Math.min(0.99, Math.max(0.01, impliedProbSide));
  const gross = stakeUsd * (1 / p - 1);
  const shareBps = opts?.sharePriceBps;
  const useWeighted =
    (opts?.feeModel == null || opts?.feeModel === "probability-weighted") && shareBps != null;
  const effBps = useWeighted ? effectiveFeeBpsAtSharePrice(totalFeeBps, shareBps) : totalFeeBps;
  const net = gross * (1 - effBps / 10_000);
  return Number.isFinite(net) ? Math.max(0, net) : 0;
}
