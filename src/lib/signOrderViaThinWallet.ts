import { hashTypedData, type TypedDataDomain } from "viem";
import { ORDER_TYPES, type OrderSignMessage } from "./eip712";

/**
 * Phase 4 / Gate ThinWallet — WalletAuth-wrap signing for the ERC-1271 path.
 *
 * Why two steps:
 *   1. Settlement / matching engine verify a signature whose `maker` is a
 *      contract (the user's ThinWallet) by calling
 *      `SignatureChecker.isValidSignatureNow(maker, digest, sig)`. That
 *      routes to `ThinWallet.isValidSignature(digest, sig)`.
 *   2. ThinWallet does NOT recover from `digest` directly. It wraps the
 *      hash in a `WalletAuth(bytes32 hash)` typed-data struct bound to the
 *      WALLET's own EIP-712 domain (name=PulsePairsThinWallet, v=1, chainId,
 *      verifyingContract=<this wallet address>), recovers the signer from
 *      THAT digest, and checks recovered === owner.
 *
 * So for ANY backend-verified typed-data (Order, Cancel, Withdraw, future
 * shapes), the client must:
 *   - Compute the source-domain digest off-chain (`hashTypedData`).
 *   - Sign a WalletAuth-wrapped envelope against the TW's own domain.
 *
 * `signTypedDataViaThinWallet` is the general primitive. `signOrderViaThinWallet`
 * is a thin caller for the Order shape (kept for back-compat + readability
 * at the call site). Cancel + future shapes call the general primitive directly.
 *
 * EIP-712 domain binding ensures a sig for Wallet A cannot replay against
 * Wallet B (the Alchemy LightAccount guardrail). See:
 *   updown-contracts test/ThinWallet.t.sol::test_isValidSignature_rejectsReplayAcrossWallets
 */

const WALLET_AUTH_TYPES = {
  WalletAuth: [{ name: "hash", type: "bytes32" }],
} as const;

const THIN_WALLET_DOMAIN_NAME = "PulsePairsThinWallet";
const THIN_WALLET_DOMAIN_VERSION = "1";

/** wagmi-compatible signTypedData callable, bound to the connected EOA. */
type SignTypedDataAsyncWalletAuth = (args: {
  domain: TypedDataDomain;
  types: typeof WALLET_AUTH_TYPES;
  primaryType: "WalletAuth";
  message: { hash: `0x${string}` };
}) => Promise<`0x${string}`>;

export type SignTypedDataViaThinWalletArgs = {
  /** Source domain — Settlement's EIP-712 domain for Orders/Cancels. */
  sourceDomain: TypedDataDomain;
  /** Source typed-data types — ORDER_TYPES / CANCEL_TYPES / etc.
   *  Typed as a loose record because viem's strict TypedDataDefinition
   *  generic is awkward to thread through a reusable helper. Callers
   *  know the shape; we just pass through to viem. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceTypes: any;
  /** Primary type name in `sourceTypes`. */
  sourcePrimaryType: string;
  /** Source message body, matching `sourceTypes[sourcePrimaryType]`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceMessage: any;
  /** User's ThinWallet address (= source message's "maker"/"wallet" field). */
  twAddress: `0x${string}`;
  /** Active chainId (must match both source + TW domain). */
  chainId: number;
  /** wagmi `signTypedDataAsync` callable, bound to the connected EOA. */
  signTypedDataAsync: SignTypedDataAsyncWalletAuth;
};

/**
 * General primitive: hash the source typed-data, wrap in WalletAuth against
 * the TW's domain, sign via the EOA. Returns the ERC-1271-compatible signature.
 */
export async function signTypedDataViaThinWallet(
  args: SignTypedDataViaThinWalletArgs,
): Promise<`0x${string}`> {
  const {
    sourceDomain,
    sourceTypes,
    sourcePrimaryType,
    sourceMessage,
    twAddress,
    chainId,
    signTypedDataAsync,
  } = args;

  // Step 1: hash the source typed-data off-chain.
  const sourceDigest = hashTypedData({
    domain: sourceDomain,
    types: sourceTypes,
    primaryType: sourcePrimaryType,
    message: sourceMessage,
  });

  // Step 2: sign a WalletAuth wrap against the TW's domain. The MetaMask
  // popup shows the TW domain (name=PulsePairsThinWallet, verifyingContract=
  // <TW>) + the bytes32 hash field.
  const twDomain: TypedDataDomain = {
    name: THIN_WALLET_DOMAIN_NAME,
    version: THIN_WALLET_DOMAIN_VERSION,
    chainId,
    verifyingContract: twAddress,
  };
  return signTypedDataAsync({
    domain: twDomain,
    types: WALLET_AUTH_TYPES,
    primaryType: "WalletAuth",
    message: { hash: sourceDigest },
  });
}

// ── Back-compat / convenience: Order shape ─────────────────────────────

export type SignOrderViaThinWalletArgs = {
  /** The order to be signed; `maker` should already equal `twAddress`. */
  order: OrderSignMessage;
  /** Settlement's EIP-712 domain (from ApiConfig.eip712.domain). */
  settlementDomain: TypedDataDomain;
  /** User's ThinWallet address (= order.maker). */
  twAddress: `0x${string}`;
  /** Active chainId (must match both Settlement + TW domain). */
  chainId: number;
  /** wagmi `signTypedDataAsync` callable, bound to the connected EOA. */
  signTypedDataAsync: SignTypedDataAsyncWalletAuth;
};

export async function signOrderViaThinWallet(
  args: SignOrderViaThinWalletArgs,
): Promise<`0x${string}`> {
  return signTypedDataViaThinWallet({
    sourceDomain: args.settlementDomain,
    sourceTypes: ORDER_TYPES,
    sourcePrimaryType: "Order",
    sourceMessage: args.order as unknown as Record<string, unknown>,
    twAddress: args.twAddress,
    chainId: args.chainId,
    signTypedDataAsync: args.signTypedDataAsync,
  });
}
