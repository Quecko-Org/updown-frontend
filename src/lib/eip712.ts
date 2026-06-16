import type { ApiConfig } from "./api";

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "market", type: "uint256" },
    { name: "option", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "type", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "amount", type: "uint256" },
    // F-2026-17731 (Hacken remediation V2): signed fee cap — the max total fee
    // (platformFee + makerFee) this order will pay WHEN FILLED AS THE TAKER. The
    // settlement contract caps the relayer-supplied fee at `takerOrder.maxFee`, so
    // the relayer can never charge more than the user cryptographically committed to.
    // Field order MUST match `ORDER_TYPEHASH` in UpDownSettlement.sol and the backend's
    // `EIP712_ORDER_TYPES` exactly (maxFee between amount and nonce) — any drift makes
    // the on-chain `SignatureChecker` reject the signature.
    { name: "maxFee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

// PR-13 (P1-4 backend): cancel sigs gain `nonce` + `expiry` so a captured
// signature can't be replayed forever. Field names mirror Polymarket's
// clob-client cancel typed-data shape so any future SDK is drop-in.
export const CANCEL_TYPES = {
  Cancel: [
    { name: "maker", type: "address" },
    { name: "orderId", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const WITHDRAW_TYPES = {
  Withdraw: [
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type OrderSignMessage = {
  maker: `0x${string}`;
  /** Numeric market id from settlement contract (same as composite key suffix). */
  market: bigint;
  option: bigint;
  side: number;
  type: number;
  price: bigint;
  amount: bigint;
  /** F-2026-17731: signed fee cap (atomic USDT). Max total fee paid when filled as taker. */
  maxFee: bigint;
  nonce: bigint;
  expiry: bigint;
};

export function buildOrderTypedData(
  cfg: ApiConfig,
  msg: OrderSignMessage
): {
  domain: (typeof cfg)["eip712"]["domain"];
  types: typeof ORDER_TYPES;
  primaryType: "Order";
  message: OrderSignMessage;
} {
  return {
    domain: cfg.eip712.domain as (typeof cfg)["eip712"]["domain"],
    types: ORDER_TYPES,
    primaryType: "Order",
    message: msg,
  };
}

export function buildCancelTypedData(
  cfg: ApiConfig,
  maker: `0x${string}`,
  orderId: string,
  nonce: bigint,
  expiry: bigint,
) {
  return {
    domain: cfg.eip712.domain as (typeof cfg)["eip712"]["domain"],
    types: CANCEL_TYPES,
    primaryType: "Cancel" as const,
    message: { maker, orderId, nonce, expiry },
  };
}

// PR-13: helper for the call site so the random-uint64 + 5-min-expiry
// recipe stays in one place. Uses crypto.getRandomValues for cryptographic
// freshness — anything less risks two parallel cancel clicks generating
// the same nonce. (BigInt-literal-free for ES2017 target.)
export function freshCancelNonce(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let n = BigInt(0);
  const EIGHT = BigInt(8);
  for (const b of buf) n = (n << EIGHT) | BigInt(b);
  return n;
}

export function cancelExpirySeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
}

export function buildWithdrawTypedData(
  cfg: ApiConfig,
  wallet: `0x${string}`,
  amount: bigint,
  nonce: bigint
) {
  return {
    domain: cfg.eip712.domain as (typeof cfg)["eip712"]["domain"],
    types: WITHDRAW_TYPES,
    primaryType: "Withdraw" as const,
    message: { wallet, amount, nonce },
  };
}
