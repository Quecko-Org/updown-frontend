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
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const CANCEL_TYPES = {
  Cancel: [
    { name: "maker", type: "address" },
    { name: "orderId", type: "string" },
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
  orderId: string
) {
  return {
    domain: cfg.eip712.domain as (typeof cfg)["eip712"]["domain"],
    types: CANCEL_TYPES,
    primaryType: "Cancel" as const,
    message: { maker, orderId },
  };
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
