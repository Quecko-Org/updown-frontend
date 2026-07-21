import type { OrderBookResponse, OrderBookSide } from "@/lib/api";

/**
 * Complementary matching (MINT / MERGE) — the read-time unified-book transform.
 *
 * A complete set is worth $1 = 10000 bps: `UP + DOWN = 10000`. So a resting DOWN
 * BID @ q (someone will pay q for DOWN) is, for an UP buyer, a synthetic UP ASK @
 * (10000 − q): pairing them mints a fresh set — the DOWN buyer takes the DOWN leg,
 * the UP buyer the UP leg, and their two prices fund the whole $1. Symmetrically a
 * DOWN ASK @ q (a share-covered DOWN sale) is a synthetic UP BID @ (10000 − q): the
 * two SELLs burn a set. Depth is 1:1 in shares (minting/burning N sets moves N of
 * each leg).
 *
 * Rendering this makes the two option books read as ONE deep book per side, so a
 * BUY UP sees DOWN buy-side demand as fillable ask liquidity (and vice-versa) —
 * exactly what the engine's `matchComplementary` / the contract's `mintMatch` do.
 *
 * Pure + BigInt-only on `depth`; returns a NEW object and never mutates the raw
 * React Query cache (so the real `bids`/`asks` — and the share-covered SELL path —
 * stay untouched). When `enabled` is false it returns `book` unchanged.
 */

const COMPLEMENT_BPS = 10000;

export type SyntheticLevel = {
  price: number;
  depth: string;
  count: number;
  /** Marks a level sourced from the complementary book (a mint/merge cross). */
  synthetic?: boolean;
};

type RawLevel = { price: number; depth: string; count: number };

/** Merge two level lists by identical bps price, summing depth (BigInt) + count. */
function mergeByPrice(a: SyntheticLevel[], b: SyntheticLevel[]): SyntheticLevel[] {
  const byPrice = new Map<number, SyntheticLevel>();
  for (const lvl of [...a, ...b]) {
    // Defensive: a synthetic complement must land strictly inside the tradeable band.
    if (lvl.price <= 0 || lvl.price >= COMPLEMENT_BPS) continue;
    const existing = byPrice.get(lvl.price);
    if (!existing) {
      byPrice.set(lvl.price, { ...lvl });
      continue;
    }
    let sum: bigint;
    try {
      sum = BigInt(existing.depth || "0") + BigInt(lvl.depth || "0");
    } catch {
      sum = BigInt(existing.depth || "0");
    }
    byPrice.set(lvl.price, {
      price: lvl.price,
      depth: sum.toString(),
      count: existing.count + lvl.count,
      synthetic: existing.synthetic || lvl.synthetic,
    });
  }
  return [...byPrice.values()];
}

/** A DOWN level @ q becomes a synthetic UP level @ (10000 − q) with the same depth. */
function complement(levels: RawLevel[]): SyntheticLevel[] {
  return levels.map((l) => ({
    price: COMPLEMENT_BPS - l.price,
    depth: l.depth,
    count: l.count,
    synthetic: true,
  }));
}

/**
 * Fold complementary liquidity into each side. For the UP column, DOWN bids become
 * synthetic UP asks and DOWN asks become synthetic UP bids (and mirror for DOWN).
 * Real bids/asks are preserved as-is (non-synthetic) so the SELL path is unaffected.
 */
/**
 * Ask levels best-first = ascending (cheapest sell first); bid levels best-first =
 * descending (highest buy first). `walkBookForBudget` / `walkBookForAvgFillPrice`
 * and the `levels[0]` best-price reads walk levels IN ORDER, so the merged output
 * MUST be sorted — a Map's insertion order is not.
 */
function sortAsks(levels: SyntheticLevel[]): SyntheticLevel[] {
  return [...levels].sort((a, b) => a.price - b.price);
}
function sortBids(levels: SyntheticLevel[]): SyntheticLevel[] {
  return [...levels].sort((a, b) => b.price - a.price);
}

/** The subset of an order row the viewer-level marking needs. */
export type ViewerOrderLeg = {
  /** 1 = UP, 2 = DOWN (backend Order.option). */
  option: number;
  /** 0 = BUY, 1 = SELL (backend Order.side). */
  side: number;
  /** Integer bps 1..9999. */
  price: number;
  status: string;
};

const VIEWER_OPEN_STATUSES = new Set(["OPEN", "PARTIALLY_FILLED"]);

/**
 * Book levels (`"<up|down>|<bid|ask>|<bps>"`) that contain one of the viewer's
 * own open orders, so the panel can badge them "you" (QA round-5: a user read
 * their own resting order as a mystery duplicate). Under complementary
 * matching each order also appears MIRRORED on the opposite column (a BUY UP
 * resting at p is the DOWN column's synthetic ask at 10000−p — crossing either
 * executes the same order), so both keys are emitted when `complementary`.
 */
export function viewerLevelKeys(
  orders: ViewerOrderLeg[] | undefined,
  complementary: boolean,
): Set<string> {
  const keys = new Set<string>();
  for (const o of orders ?? []) {
    if (!VIEWER_OPEN_STATUSES.has(o.status)) continue;
    if (!Number.isInteger(o.price) || o.price <= 0 || o.price >= COMPLEMENT_BPS) continue;
    const own = o.option === 1 ? "up" : o.option === 2 ? "down" : null;
    if (!own) continue;
    const opp = own === "up" ? "down" : "up";
    const kind = o.side === 0 ? "bid" : "ask";
    const mirror = o.side === 0 ? "ask" : "bid";
    keys.add(`${own}|${kind}|${o.price}`);
    if (complementary) keys.add(`${opp}|${mirror}|${COMPLEMENT_BPS - o.price}`);
  }
  return keys;
}

/**
 * Non-crossing LIMIT check for the trade form (QA round-5 follow-up: a user
 * typed a 50¢ BUY whose "To Win $20" was exact-if-filled, but the order rested
 * because 50¢ sits below the 50.5¢ synthetic ask — it never crossed, so it
 * silently read as a phantom "$20 order that did nothing").
 *
 * The executable price a marketable order must reach is the best synthetic ASK
 * for a BUY and the best BID for a SELL (see `unifyOrderBook` — a BUY UP crosses
 * DOWN buy-side demand at 10000 − oppBid). A BUY crosses when its limit is at
 * least the ask; a SELL when its limit is at most the bid. EQUAL price is
 * crossing (marketable), so exactly at the ask/bid there is NO hint.
 *
 * Returns the executable price (integer bps) the resting order fails to reach,
 * or `null` when the order is marketable OR there is no book liquidity on the
 * relevant side to compare against (no synthetic ask ⇒ caller shows nothing).
 */
export function nonCrossingExecutableBps(args: {
  orderSide: 0 | 1; // 0 = BUY, 1 = SELL
  limitBps: number;
  bestAskBps: number | null | undefined; // best (synthetic) ask, for a BUY
  bestBidBps: number | null | undefined; // best bid, for a SELL
}): number | null {
  const { orderSide, limitBps } = args;
  if (!Number.isFinite(limitBps) || limitBps <= 0) return null;
  if (orderSide === 0) {
    const ask = args.bestAskBps;
    if (ask == null || !Number.isFinite(ask) || ask <= 0) return null;
    // Crosses when the buyer offers at least the ask; rests strictly below it.
    return limitBps < ask ? ask : null;
  }
  const bid = args.bestBidBps;
  if (bid == null || !Number.isFinite(bid) || bid <= 0) return null;
  // Crosses when the seller accepts at most the bid; rests strictly above it.
  return limitBps > bid ? bid : null;
}

export function unifyOrderBook(
  book: OrderBookResponse,
  enabled: boolean,
): OrderBookResponse {
  if (!enabled) return book;

  const up: OrderBookSide = {
    // A BUY UP can now cross real UP asks OR DOWN buy-side demand (mint).
    asks: sortAsks(mergeByPrice(book.up.asks as SyntheticLevel[], complement(book.down.bids))),
    // A SELL UP can cross real UP bids OR DOWN sell-side supply (merge).
    bids: sortBids(mergeByPrice(book.up.bids as SyntheticLevel[], complement(book.down.asks))),
  };
  const down: OrderBookSide = {
    asks: sortAsks(mergeByPrice(book.down.asks as SyntheticLevel[], complement(book.up.bids))),
    bids: sortBids(mergeByPrice(book.down.bids as SyntheticLevel[], complement(book.up.asks))),
  };
  return { up, down };
}
