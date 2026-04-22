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
 * Sign a userOpHash using the stored session key. Returns a 0x-prefixed
 * 65-byte secp256k1 signature (r || s || v) produced via personal_sign
 * (EIP-191) — matches the `personal_sign` branch in Alchemy's
 * `signSignatureRequest.ts` (the only path the wallet server accepts
 * for secp256k1 session signers).
 *
 * Uses `{ message: { raw: hex } }` explicitly so the 32-byte hash is
 * treated as raw bytes, not as a UTF-8 string. `signMessage(hexString)`
 * would interpret the `"0x..."` literal characters as the message,
 * producing a signature over different bytes — and
 * `recoverMessageAddress({ message: { raw } })` would no longer match.
 */
export async function signUserOpHash(
  smartAccountAddress: string,
  userOpHashHex: string
): Promise<`0x${string}`> {
  const kp = await getStoredSessionKey(smartAccountAddress);
  if (!kp) {
    throw new Error(
      `No session key found for ${smartAccountAddress}; the user must re-grant the scoped session`
    );
  }
  const account = privateKeyToAccount(kp.privateKey);
  return (await account.signMessage({
    message: { raw: userOpHashHex as `0x${string}` },
  })) as `0x${string}`;
}
