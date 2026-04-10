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
  const res = await fetch(url(`/markets/${address}`));
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
  const res = await fetch(url(`/orderbook/${marketId}`));
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

export type BalanceResponse = {
  wallet: string;
  available: string;
  inOrders: string;
  totalDeposited: string;
  totalWithdrawn: string;
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

export type PostOrderBody = {
  maker: string;
  market: string;
  option: number;
  side: number | "BUY" | "SELL";
  type: number | "LIMIT" | "MARKET";
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
  body: { maker: string; signature: string }
): Promise<unknown> {
  const res = await fetch(url(`/orders/${orderId}`), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function postWithdraw(body: {
  wallet: string;
  amount: string;
  signature: string;
}): Promise<{ txHash: string; amount: string; newAvailable: string }> {
  const res = await fetch(url("/balance/withdraw"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function postMarketClaim(marketAddress: string): Promise<{ ok: boolean }> {
  const res = await fetch(url(`/markets/${marketAddress}/claim`), { method: "POST" });
  return parseJson(res);
}
