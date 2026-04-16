/** Rough profit if the chosen side wins (binary-style), after notional fee haircut. */
export function approxProfitIfSideWinsUsd(
  stakeUsd: number,
  impliedProbSide: number,
  totalFeeBps: number,
): number {
  if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) return 0;
  const p = Math.min(0.99, Math.max(0.01, impliedProbSide));
  const gross = stakeUsd * (1 / p - 1);
  const net = gross * (1 - totalFeeBps / 10000);
  return Number.isFinite(net) ? Math.max(0, net) : 0;
}
