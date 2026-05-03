import { API_BASE } from "./env";

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg || res.statusText);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function url(path: string, query?: Record<string, string | number | undefined>) {
  const base = API_BASE.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const u = new URL(`${base}${p}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export type ApiConfig = {
  chainId: number;
  usdtAddress: string;
  relayerAddress: string;
  platformFeeBps: number;
  makerFeeBps: number;
  /** e.g. `"probability-weighted"` — when set, fee UI uses Polymarket-style weighting. */
  feeModel?: string;
  /** Max combined fee bps (typically at 50¢); from GET /config when present. */
  peakFeeBps?: number;
  /** DMM maker rebate bps from GET /config when present (e.g. 30). */
  dmmRebateBps?: number;
  usdtDecimals: number;
  eip712: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
  };
};

export async function getConfig(): Promise<ApiConfig> {
  const res = await fetch(url("/config"));
  return parseJson<ApiConfig>(res);
}

export type PairSymbol = "BTC-USD" | "ETH-USD";

export type MarketListItem = {
  address: string;
  pairId: string;
  /** Preferred display / filter key from API */
  pairSymbol?: string;
  /** Spot chart symbol for price history proxy */
  chartSymbol?: "BTC" | "ETH";
  startTime: number;
  endTime: number;
  duration: number;
  status: string;
  winner: number | null;
  upPrice: string;
  downPrice: string;
  strikePrice?: string;
  /** Chainlink settlement at resolution (resolved/claimed); same scale as strikePrice. */
  settlementPrice?: string;
  volume: string;
};

export async function getMarkets(
  timeframe?: 300 | 900 | 3600,
  pair?: PairSymbol
): Promise<MarketListItem[]> {
  const res = await fetch(
    url("/markets", {
      ...(timeframe ? { timeframe } : {}),
      ...(pair ? { pair } : {}),
    })
  );
  return parseJson<MarketListItem[]>(res);
}

export type MarketDetail = MarketListItem & {
  volume: string;
  timeRemainingSeconds: number;
  orderBook: {
    up: {
      bestBid: { price: number; depth: string } | null;
      bestAsk: { price: number; depth: string } | null;
    };
    down: {
      bestBid: { price: number; depth: string } | null;
      bestAsk: { price: number; depth: string } | null;
    };
  };
};

export async function getMarket(address: string): Promise<MarketDetail> {
  const res = await fetch(url(`/markets/${encodeURIComponent(address)}`));
  return parseJson<MarketDetail>(res);
}

export type OrderBookSide = {
  bids: { price: number; depth: string; count: number }[];
  asks: { price: number; depth: string; count: number }[];
};

export type OrderBookResponse = {
  up: OrderBookSide;
  down: OrderBookSide;
};

export async function getOrderbook(marketId: string): Promise<OrderBookResponse> {
  const res = await fetch(url(`/orderbook/${encodeURIComponent(marketId)}`));
  return parseJson<OrderBookResponse>(res);
}

export type PositionRow = {
  market: string;
  marketStatus: string;
  option: number;
  optionLabel: string;
  shares: string;
  avgPrice: number;
  costBasis: string;
};

export async function getPositions(wallet: string): Promise<PositionRow[]> {
  const res = await fetch(url(`/positions/${wallet}`));
  return parseJson<PositionRow[]>(res);
}

export type TradeRow = {
  tradeId: string;
  market: string;
  option: number;
  buyOrderId: string;
  sellOrderId: string;
  buyer: string;
  seller: string;
  price: number;
  amount: string;
  platformFee: string;
  makerFee: string;
  settlementStatus: string;
  createdAt: string;
};

export async function getTrades(wallet: string, limit = 50, offset = 0): Promise<TradeRow[]> {
  const res = await fetch(url(`/trades/${wallet}`, { limit, offset }));
  return parseJson<TradeRow[]>(res);
}

export type OrderRow = {
  orderId: string;
  maker: string;
  market: string;
  option: number;
  side: number;
  type: number;
  price: number;
  amount: string;
  filledAmount: string;
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
  /** Present on CANCELLED rows when the backend knows why. */
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrdersListResponse = {
  orders: OrderRow[];
  total: number;
  limit: number;
  offset: number;
};

export async function getOrders(
  wallet: string,
  query: { limit?: number; offset?: number; status?: string | string[]; market?: string } = {},
): Promise<OrdersListResponse> {
  const params: Record<string, string | number | undefined> = {
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
    market: query.market,
  };
  // `status` accepts repeated param values on the backend; URL builder only
  // takes a single value per key, so join into a CSV as a practical shim.
  if (Array.isArray(query.status)) params.status = query.status.join(",");
  else if (query.status) params.status = query.status;
  const res = await fetch(url(`/orders/${wallet}`, params));
  return parseJson<OrdersListResponse>(res);
}

export type BalanceResponse = {
  wallet: string;
  smartAccountAddress: string;
  available: string;
  inOrders: string;
  /** Total on-chain USDT held by the smart account, synced by SmartAccountBalanceSync. */
  cachedBalance: string;
  balanceLastSyncedAt: string | null;
  withdrawNonce: number;
};

export async function getBalance(wallet: string): Promise<BalanceResponse> {
  const res = await fetch(url(`/balance/${wallet}`));
  return parseJson<BalanceResponse>(res);
}

export type StatsResponse = {
  totalVolume: string;
  activeMarketsCount: number;
  totalTraders: number;
};

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(url("/stats"));
  return parseJson<StatsResponse>(res);
}

export async function getPriceHistory(symbol: string, query?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url(`/prices/history/${symbol}`, query));
  return parseJson<unknown>(res);
}

/**
 * PR-20 Phase 2: per-market Chainlink + Coinbase-backfill price history,
 * keyed by market address. Replaces the symbol-wide `getPriceHistory`
 * call for the market-detail chart so resolved markets keep their full
 * journey instead of falling back to a moving symbol-wide feed.
 *
 * Returns `[[timestampMs, priceString], ...]` (oldest first), same wire
 * shape as `getPriceHistory` so the existing chart parser
 * (`normalizePriceHistoryData`) handles both without branching.
 *
 * The backend stores Chainlink's raw 8-decimals integer (e.g. BTC at $90k
 * is `9000000000000`). The chart compares price points to strike, which
 * arrives as the same 8-decimals raw and is descaled by `formatUnits` in
 * `parseStrikeUsdNumber`. We descale here for symmetry — every consumer
 * of `[timestampMs, priceString]` (chart, sparkline, sortByTime helpers)
 * already treats the second cell as a dollar-denominated string from the
 * Coinbase proxy, so emitting dollars keeps the call sites untouched.
 */
const PRICE_SCALE_8DEC = 1e8;

export async function getMarketPrices(
  address: string,
  from?: number,
  to?: number,
): Promise<[number, string][]> {
  const query: Record<string, string | number | undefined> = {};
  if (typeof from === "number" && Number.isFinite(from)) query.from = from;
  if (typeof to === "number" && Number.isFinite(to)) query.to = to;
  const res = await fetch(url(`/markets/${encodeURIComponent(address)}/prices`, query));
  const raw = await parseJson<[number, string | number][]>(res);
  return raw.map(([t, p]) => {
    const n = typeof p === "string" ? Number(p) : p;
    if (!Number.isFinite(n) || n <= 0) return [t, "0"];
    return [t, (n / PRICE_SCALE_8DEC).toString()];
  });
}

export type OrderApiType = "LIMIT" | "MARKET" | "POST_ONLY" | "IOC";

/** Must match backend order `type` uint8 enum. */
export const ORDER_TYPE_U8: Record<OrderApiType, number> = {
  LIMIT: 0,
  MARKET: 1,
  POST_ONLY: 2,
  IOC: 3,
};

export type PostOrderBody = {
  maker: string;
  /** Composite key settlementAddress-marketId for REST. */
  market: string;
  option: number;
  side: number | "BUY" | "SELL";
  type: number | OrderApiType;
  price?: number;
  amount: string;
  nonce: number;
  expiry: number;
  signature: string;
};

export async function postOrder(body: PostOrderBody): Promise<unknown> {
  const res = await fetch(url("/orders"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function cancelOrder(
  orderId: string,
  body: {
    maker: string;
    signature: string;
    /** PR-13 (P1-4): backend requires nonce + expiry on every cancel. */
    nonce: bigint | string;
    expiry: bigint | string;
  }
): Promise<unknown> {
  const res = await fetch(url(`/orders/${orderId}`), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maker: body.maker,
      signature: body.signature,
      nonce: body.nonce.toString(),
      expiry: body.expiry.toString(),
    }),
  });
  return parseJson(res);
}


export async function postMarketClaim(marketAddress: string): Promise<{ ok: boolean }> {
  const enc = encodeURIComponent(marketAddress);
  const res = await fetch(url(`/markets/${enc}/claim`), { method: "POST" });
  return parseJson(res);
}

export type DmmStatusResponse = {
  isDmm: boolean;
  rebateBps?: number;
};

type DmmListResponse = { dmms: Array<{ wallet?: string; address?: string } | string> };

export async function getDmmStatus(wallet: string): Promise<DmmStatusResponse> {
  const res = await fetch(url("/dmm/list"));
  const data = await parseJson<DmmListResponse>(res);
  const target = wallet.toLowerCase();
  const list = data?.dmms ?? [];
  const isDmm = list.some((entry) => {
    if (typeof entry === "string") return entry.toLowerCase() === target;
    const w = entry.wallet ?? entry.address;
    return typeof w === "string" && w.toLowerCase() === target;
  });
  return { isDmm };
}

export type DmmRebateClaimRow = {
  amount?: string;
  claimedAt?: string;
  txHash?: string;
};

export type DmmRebatesResponse = {
  accumulatedRebate?: string;
  pendingRebate?: string;
  totalClaimed?: string;
  claimHistory?: DmmRebateClaimRow[];
  /** Allow extra fields from API */
  [key: string]: unknown;
};

export async function getDmmRebates(wallet: string): Promise<DmmRebatesResponse> {
  const res = await fetch(url(`/dmm/rebates/${encodeURIComponent(wallet)}`));
  return parseJson<DmmRebatesResponse>(res);
}

export async function postDmmClaimRebate(body: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(url("/dmm/claim-rebate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function deleteAllMarketOrders(marketComposite: string): Promise<unknown> {
  const enc = encodeURIComponent(marketComposite);
  const res = await fetch(url(`/orders/market/${enc}`), { method: "DELETE" });
  return parseJson(res);
}
