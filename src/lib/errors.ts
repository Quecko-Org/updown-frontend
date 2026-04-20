/** Map wallet / API errors to short user-facing copy. */
export function formatUserFacingError(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message;
    if (/user rejected|denied|4001|rejected the request/i.test(m)) {
      return "Cancelled in wallet.";
    }
    // Tightened: match USDT-balance shortfalls only. The SELL pre-check throws
    // "Insufficient shares to sell…" and we want that message surfaced verbatim,
    // not rewritten as a USDT balance issue (Shoaib BUG 3 false-match cause).
    if (/insufficient\s+(funds|usdt|balance)/i.test(m) && !/insufficient\s+shares/i.test(m)) {
      return "Insufficient USDT balance for this action.";
    }
    if (/network|fetch failed|failed to fetch|ECONNREFUSED/i.test(m)) {
      return "Network error. Check your connection and try again.";
    }
    if (/Too many requests|429/i.test(m)) {
      return "Too many requests. Wait a moment and try again.";
    }
    if (m.length > 220) return `${m.slice(0, 220)}…`;
    return m;
  }
  return "Something went wrong.";
}
