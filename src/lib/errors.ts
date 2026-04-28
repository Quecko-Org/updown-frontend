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
      return "Insufficient USDT balance.";
    }
    if (/network|fetch failed|failed to fetch|ECONNREFUSED/i.test(m)) {
      return "Network error. Check your connection and retry.";
    }
    if (/Too many requests|429/i.test(m)) {
      return "Rate limited. Wait a moment and retry.";
    }
    // Wallet RPC layer occasionally returns "JSON is not a valid request object"
    // / -32600 / "Invalid request" when the provider hiccups mid-call. The error
    // is recoverable on retry; surface clean copy instead of the raw JSON-RPC
    // string. Audit-pattern: covers TradeForm (approve + sign), CancelOrderButton.
    if (/JSON is not a valid request object|invalid request|-32600/i.test(m)) {
      return "Wallet hiccuped. Please try again.";
    }
    // F2: order placement on a market that's already past its countdown.
    // The race window is small (countdown 0:00 → backend status flip) but
    // happens often enough to confuse users. Prior copy was the raw
    // "Market not active" string surfaced as-is. Now: friendlier nudge
    // that points the user at the next active market.
    if (/Market not active/i.test(m)) {
      return "This market has ended. Open the live market and try again.";
    }
    if (/Invalid signature/i.test(m)) {
      return "Wallet signature couldn't be verified. Please try again.";
    }
    if (m.length > 220) return `${m.slice(0, 220)}…`;
    return m;
  }
  return "Unknown error. Retry.";
}

/**
 * Returns true when the error looks like a user-initiated cancellation in the
 * wallet popup (MetaMask "User rejected the request", code 4001, etc). Used by
 * call sites that auto-retry recoverable RPC failures: a user-rejection should
 * NOT trigger a retry — the user explicitly said no.
 */
export function isUserRejection(e: unknown): boolean {
  if (e instanceof Error) {
    return /user rejected|denied|4001|rejected the request/i.test(e.message);
  }
  return false;
}
