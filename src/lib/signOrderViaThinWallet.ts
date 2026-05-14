import { hashTypedData, type TypedDataDomain } from "viem";
import { ORDER_TYPES, type OrderSignMessage } from "./eip712";

/**
 * Phase 4 / Gate ThinWallet — two-step order signing for the ERC-1271 path.
 *
 * Why two steps:
 *   1. Settlement.fill verifies `SignatureChecker.isValidSignatureNow(order.maker, orderDigest, sig)`.
 *      When `order.maker` is a contract (the user's ThinWallet), this routes
 *      to `ThinWallet.isValidSignature(orderDigest, sig)`.
 *   2. ThinWallet does NOT recover from `orderDigest` directly. It wraps the
 *      hash in a `WalletAuth(bytes32 hash)` typed-data struct bound to the
 *      WALLET's own EIP-712 domain (name=PulsePairsThinWallet, v=1, chainId,
 *      verifyingContract=<this wallet address>), recovers the signer from
 *      THAT digest, and checks recovered === owner.
 *
 * So the client must:
 *   - Compute the Settlement-domain order digest off-chain (`hashTypedData`).
 *   - Sign a WalletAuth-wrapped envelope against the TW's own domain.
 *
 * The signature flows verbatim through the API, the matching engine, and into
 * Settlement.fill, where the on-chain SignatureChecker call dispatches to the
 * TW's ERC-1271 implementation and the recovery succeeds.
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

export type SignOrderViaThinWalletArgs = {
  /** The order to be signed; `maker` should already equal `twAddress`. */
  order: OrderSignMessage;
  /** Settlement's EIP-712 domain (from ApiConfig.eip712.domain). */
  settlementDomain: TypedDataDomain;
  /** The user's ThinWallet address (= order.maker). */
  twAddress: `0x${string}`;
  /** Active chainId (must match both Settlement + TW domain). */
  chainId: number;
  /** wagmi `signTypedDataAsync` callable, bound to the connected EOA. */
  signTypedDataAsync: (args: {
    domain: TypedDataDomain;
    types: typeof WALLET_AUTH_TYPES;
    primaryType: "WalletAuth";
    message: { hash: `0x${string}` };
  }) => Promise<`0x${string}`>;
};

export async function signOrderViaThinWallet(
  args: SignOrderViaThinWalletArgs,
): Promise<`0x${string}`> {
  const { order, settlementDomain, twAddress, chainId, signTypedDataAsync } = args;

  // Step 1: Compute the Settlement-domain order digest off-chain.
  const orderDigest = hashTypedData({
    domain: settlementDomain,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  // Step 2: Sign a WalletAuth envelope against the ThinWallet's domain.
  // The EOA-side wallet popup shows the TW domain (name=PulsePairsThinWallet,
  // verifyingContract=<TW>) and the bytes32 hash field — clean UX for the user.
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
    message: { hash: orderDigest },
  });
}
