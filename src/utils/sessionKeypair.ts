/**
 * Option C — per-wallet P-256 signing keypair for non-custodial scoped sessions.
 *
 * The private half is generated as a WebCrypto CryptoKey with
 * `extractable: false`, so it literally cannot be exported back to
 * JavaScript, let alone leak to the server. It is stored in IndexedDB
 * (which supports non-extractable CryptoKey objects natively) under a
 * key derived from the smart account address, so one device can hold
 * distinct sessions for distinct wallets without collision.
 *
 * The public half is exported once as SEC1 uncompressed bytes
 * (`0x04 || X || Y`), hex-encoded, and sent to the backend in the
 * `/api/smart-account/register` body. The backend uses it only to
 * address the client over WS and to cross-check the grantPermissions
 * signer matches the key we think we hold. The private half is never
 * serialized, never leaves the device.
 *
 * Signing: `signUserOpHash(account, digest)` → 0x-prefixed 64-byte
 * raw ECDSA signature (r || s). The MA v2 scoped-session module
 * accepts this shape via the `ecdsa` KeySigner type.
 */

import { getIndexKey, saveIndexKey, deleteIndexKey } from "./indexDb";

const IDB_KEY_PREFIX = "sessionKeypairP256:";

/** Key under which the keypair is stored in IndexedDB, one slot per smart account. */
export function idbKeyFor(smartAccountAddress: string): string {
  return `${IDB_KEY_PREFIX}${smartAccountAddress.toLowerCase()}`;
}

/**
 * Create a fresh non-extractable P-256 keypair and persist it in IndexedDB.
 * Returns the SEC1 uncompressed public key, hex-encoded with `0x` prefix.
 * Overwrites any existing entry for the same smart account.
 */
export async function generateAndStoreSessionKeypair(
  smartAccountAddress: string
): Promise<`0x${string}`> {
  const keypair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false /* extractable */,
    // "sign" applies to the private half; "verify" applies to the public
    // half. Declaring both is the standard WebCrypto pattern and does NOT
    // widen the private key's capabilities beyond signing.
    ["sign", "verify"]
  );
  await saveIndexKey(idbKeyFor(smartAccountAddress), keypair);
  return exportPublicKeyHex(keypair.publicKey);
}

/**
 * Export the SEC1 uncompressed public key as `0x04` + 64 hex bytes.
 * Public key is always exportable regardless of the private key's
 * extractability — that's a WebCrypto invariant.
 */
export async function exportPublicKeyHex(
  publicKey: CryptoKey
): Promise<`0x${string}`> {
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  const bytes = new Uint8Array(raw);
  // SEC1 uncompressed: 1 leading byte (0x04) + 32 bytes X + 32 bytes Y = 65 bytes.
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(
      `Unexpected SEC1 encoding: length=${bytes.length} prefix=0x${bytes[0]?.toString(16)}`
    );
  }
  return `0x${bytesToHex(bytes)}` as `0x${string}`;
}

/**
 * Read the keypair for this smart account from IndexedDB, or null if
 * not present / shape invalid. The returned CryptoKeyPair is usable
 * directly with `crypto.subtle.sign`.
 */
export async function getStoredSessionKeypair(
  smartAccountAddress: string
): Promise<CryptoKeyPair | null> {
  const kp = await getIndexKey<CryptoKeyPair>(idbKeyFor(smartAccountAddress));
  if (!kp || typeof kp !== "object" || !("privateKey" in kp) || !("publicKey" in kp)) {
    return null;
  }
  return kp;
}

/**
 * Remove the stored keypair — called on wallet disconnect so a shared
 * device doesn't leave authority for the prior wallet accessible.
 */
export async function deleteSessionKeypair(
  smartAccountAddress: string
): Promise<void> {
  await deleteIndexKey(idbKeyFor(smartAccountAddress));
}

/**
 * Sign a 32-byte digest (the server's `userOpHash`) with the session
 * private key. Returns a `0x`-prefixed raw r||s concatenation (64 bytes).
 * WebCrypto's ECDSA output is already raw; no DER envelope to unwrap.
 */
export async function signUserOpHash(
  smartAccountAddress: string,
  userOpHashHex: string
): Promise<`0x${string}`> {
  const kp = await getStoredSessionKeypair(smartAccountAddress);
  if (!kp) {
    throw new Error(
      `No session keypair found for ${smartAccountAddress}; the user must re-grant the scoped session`
    );
  }
  const msg = hexToBytes(userOpHashHex);
  if (msg.length !== 32) {
    throw new Error(`userOpHash must be 32 bytes, got ${msg.length}`);
  }
  // WebCrypto always prehashes the input with the named hash — there is
  // no "sign raw digest" mode for ECDSA. The on-chain MA v2 ECDSA
  // verification module must therefore be aligned: it should compute
  // SHA-256(userOpHash) when verifying against a P-256 scoped-session
  // signer. If that alignment fails end-to-end, the fix is on the
  // verifier side or via @noble/curves/p256 for raw-digest signing —
  // do NOT paper over by switching to `extractable: true`.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    kp.privateKey,
    msg.buffer as ArrayBuffer
  );
  const bytes = new Uint8Array(sig);
  if (bytes.length !== 64) {
    throw new Error(`Unexpected ECDSA signature length: ${bytes.length}`);
  }
  return `0x${bytesToHex(bytes)}` as `0x${string}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error(`Odd-length hex: ${hex}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
