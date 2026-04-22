/**
 * Option C — per-wallet secp256k1 session key, stored plaintext in IndexedDB.
 *
 * The session key is what Alchemy's grantPermissions authorizes on-chain as
 * the scoped signer for `enterPosition`. Under Option B the backend holds
 * this key and signs UserOps itself. Under Option C the key lives only in
 * the client's IndexedDB: the backend has the address (to recognize the
 * signer and route sign-requests) but not the private half, so the backend
 * cannot forge a UserOp without the user's device online.
 *
 * secp256k1, not P-256. An earlier iteration used a non-extractable
 * WebCrypto P-256 keypair, which would have been XSS-exfiltration-proof —
 * but @account-kit/wallet-client has no P-256 signing path (every client
 * signing branch in `signSignatureRequest.ts` returns
 * `{ type: "secp256k1", ... }`), so any P-256 design would require
 * bypassing Alchemy's bundler entirely. We chose SDK compatibility over
 * the stronger-at-rest property. See PULSEPAIRS_OPTION_C_DESIGN.md for
 * the full trade-off write-up.
 *
 * XSS surface — READ THIS BEFORE TOUCHING STORAGE.
 *   The private key is stored as plaintext hex. Any successful XSS on
 *   this origin can read it and sign arbitrary UserOps on the SA's behalf,
 *   UP TO THE SCOPE granted: `enterPosition` on the settlement contract
 *   only, capped USDT allowance, per-market cap, session expiry (48h).
 *   We do NOT attempt to encrypt the key at rest. A JS-derivable
 *   encryption key provides zero protection against an XSS attacker
 *   running in the same origin — they can re-derive the key the same
 *   way legitimate code does. Encryption in this threat model is
 *   security theater and was explicitly rejected.
 *
 *   The real defenses are on the authorization envelope, not at rest:
 *     - function selector locked to enterPosition (no withdraw, no approve)
 *     - USDT allowance capped per session
 *     - per-market cap (MA v2 module enforced)
 *     - session expiry (48h, re-grant required)
 *   These are enforced on-chain by the MA v2 scoped-session module; even
 *   an XSS-exfiltrated key cannot escape them.
 */

import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex } from "viem";
import { getIndexKey, saveIndexKey, deleteIndexKey } from "./indexDb";

const IDB_KEY_PREFIX = "sessionSignerKey:";

export function idbKeyFor(smartAccountAddress: string): string {
  return `${IDB_KEY_PREFIX}${smartAccountAddress.toLowerCase()}`;
}

type StoredSessionKey = {
  privateKey: `0x${string}`;
  address: `0x${string}`;
};

function isStoredSessionKey(x: unknown): x is StoredSessionKey {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.privateKey === "string" &&
    o.privateKey.startsWith("0x") &&
    o.privateKey.length === 66 &&
    typeof o.address === "string" &&
    o.address.startsWith("0x") &&
    o.address.length === 42
  );
}

/**
 * Generate a fresh secp256k1 private key, derive its address, persist
 * `{ privateKey, address }` in IndexedDB under a per-SA slot, and return
 * the address so the caller can pass it into `grantPermissions`.
 * Overwrites any prior entry for the same smart account.
 */
export async function generateAndStoreSessionKey(
  smartAccountAddress: string
): Promise<`0x${string}`> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const privateKey = bytesToHex(bytes) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const stored: StoredSessionKey = { privateKey, address: account.address };
  await saveIndexKey(idbKeyFor(smartAccountAddress), stored);
  return account.address;
}

/** Read the stored session key, or null if not present / shape invalid. */
export async function getStoredSessionKey(
  smartAccountAddress: string
): Promise<StoredSessionKey | null> {
  const v = await getIndexKey<unknown>(idbKeyFor(smartAccountAddress));
  return isStoredSessionKey(v) ? v : null;
}

/**
 * Remove the stored key — called on wallet disconnect so a shared device
 * doesn't leave authority for the prior wallet accessible.
 */
export async function deleteSessionKey(
  smartAccountAddress: string
): Promise<void> {
  await deleteIndexKey(idbKeyFor(smartAccountAddress));
}

/**
 * Alchemy signatureRequest shape: the two variants the wallet server
 * returns for MA v2 user-op prepared calls. See
 * `@alchemy/wallet-api-types/schemas.PreparedCall_UserOpV07x` — the
 * `signatureRequest` field is a union of exactly these two types.
 * `eip7702Auth` is a third variant in the broader SignatureRequest
 * union but is never attached to UserOp prepared calls.
 */
export type SignatureRequest =
  | {
      type: "personal_sign";
      data: string | { raw: `0x${string}` };
      rawPayload: `0x${string}`;
    }
  | {
      type: "eth_signTypedData_v4";
      data: import("viem").TypedDataDefinition;
      rawPayload: `0x${string}`;
    };

/**
 * Sign an Alchemy `signatureRequest` using the stored secp256k1 session
 * key. Returns a 65-byte hex signature (r || s || v). Branches on
 * `signatureRequest.type`:
 *
 *   - `personal_sign` → viem's `account.signMessage({ message: data })`.
 *     Alchemy sends `data` as a SignableMessage (string or `{ raw: Hex }`).
 *     viem handles both: a plain string is UTF-8-encoded before the
 *     EIP-191 prefix; `{ raw: hex }` is treated as bytes. We just pass
 *     `data` through verbatim so Alchemy's choice is honored.
 *   - `eth_signTypedData_v4` → viem's `account.signTypedData(data)`.
 *     EIP-712 hashing happens inside viem; the returned signature is
 *     over the EIP-712 struct hash, NOT the rawPayload via EIP-191.
 *
 * The shape `{ type: "secp256k1", data: signature }` is what
 * `wallet_sendPreparedCalls` expects on the server side — this function
 * returns just the hex, and the backend wraps it before submission.
 */
export async function signSignatureRequest(
  smartAccountAddress: string,
  req: SignatureRequest
): Promise<`0x${string}`> {
  const kp = await getStoredSessionKey(smartAccountAddress);
  if (!kp) {
    throw new Error(
      `No session key found for ${smartAccountAddress}; the user must re-grant the scoped session`
    );
  }
  const account = privateKeyToAccount(kp.privateKey);

  if (req.type === "personal_sign") {
    return (await account.signMessage({ message: req.data })) as `0x${string}`;
  }
  if (req.type === "eth_signTypedData_v4") {
    return (await account.signTypedData(req.data)) as `0x${string}`;
  }
  // Exhaustiveness guard — if Alchemy ships a third branch, the runtime
  // throw surfaces it clearly instead of silently producing a garbage
  // signature. Stop-and-page scenario per Option C design doc.
  const unknownType = (req as { type?: string }).type;
  throw new Error(
    `Unsupported signatureRequest type from Alchemy: ${String(unknownType)}. Expected personal_sign or eth_signTypedData_v4.`
  );
}
