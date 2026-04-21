/**
 * Node's `globalThis.crypto.subtle` implements the same WebCrypto API as
 * browsers — so the generateKey / exportKey / sign paths run verbatim.
 * IndexedDB is absent in Node, so we mock the thin K/V wrapper instead
 * of pulling in fake-indexeddb for what is (at runtime) three getters.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./indexDb", () => ({
  saveIndexKey: vi.fn(async (k: string, v: unknown) => {
    store.set(k, v);
    return true;
  }),
  getIndexKey: vi.fn(async (k: string) => store.get(k)),
  deleteIndexKey: vi.fn(async (k: string) => {
    store.delete(k);
  }),
}));

import {
  generateAndStoreSessionKeypair,
  exportPublicKeyHex,
  getStoredSessionKeypair,
  deleteSessionKeypair,
  signUserOpHash,
  idbKeyFor,
} from "./sessionKeypair";

const SA = "0xAa" + "11".repeat(19);

beforeEach(() => {
  store.clear();
});

describe("idbKeyFor", () => {
  it("namespaces by smart account and lower-cases", () => {
    expect(idbKeyFor(SA)).toBe(`sessionKeypairP256:${SA.toLowerCase()}`);
  });
});

describe("generateAndStoreSessionKeypair", () => {
  it("generates a non-extractable P-256 keypair and persists it", async () => {
    const pubHex = await generateAndStoreSessionKeypair(SA);

    // SEC1 uncompressed: 0x04 + 64 hex bytes = 132-char string (incl. 0x).
    expect(pubHex).toMatch(/^0x04[0-9a-f]{128}$/i);

    const kp = await getStoredSessionKeypair(SA);
    expect(kp).not.toBeNull();
    // Non-extractable: attempting to export the private key must reject.
    await expect(
      crypto.subtle.exportKey("raw", kp!.privateKey)
    ).rejects.toThrow();
    // Public key remains exportable.
    const reExported = await exportPublicKeyHex(kp!.publicKey);
    expect(reExported).toBe(pubHex);
  });

  it("overwrites the entry for the same smart account on re-generation", async () => {
    const first = await generateAndStoreSessionKeypair(SA);
    const second = await generateAndStoreSessionKeypair(SA);
    expect(second).not.toBe(first);
    const kp = await getStoredSessionKeypair(SA);
    expect(await exportPublicKeyHex(kp!.publicKey)).toBe(second);
  });

  it("keeps distinct entries for distinct smart accounts", async () => {
    const a = "0xAa" + "11".repeat(19);
    const b = "0xBb" + "22".repeat(19);
    await generateAndStoreSessionKeypair(a);
    await generateAndStoreSessionKeypair(b);
    expect(store.has(idbKeyFor(a))).toBe(true);
    expect(store.has(idbKeyFor(b))).toBe(true);
    expect(store.get(idbKeyFor(a))).not.toBe(store.get(idbKeyFor(b)));
  });
});

describe("getStoredSessionKeypair", () => {
  it("returns null when no entry exists", async () => {
    expect(await getStoredSessionKeypair(SA)).toBeNull();
  });

  it("returns null for a malformed entry (defense against stale keys from older schemas)", async () => {
    store.set(idbKeyFor(SA), { wrong: "shape" });
    expect(await getStoredSessionKeypair(SA)).toBeNull();
  });
});

describe("deleteSessionKeypair", () => {
  it("removes the stored entry", async () => {
    await generateAndStoreSessionKeypair(SA);
    await deleteSessionKeypair(SA);
    expect(await getStoredSessionKeypair(SA)).toBeNull();
  });
});

describe("signUserOpHash", () => {
  it("signs a 32-byte digest and returns a 64-byte hex signature (raw r||s)", async () => {
    await generateAndStoreSessionKeypair(SA);
    const digest =
      "0x" + "ab".repeat(32); // arbitrary 32-byte digest
    const sig = await signUserOpHash(SA, digest);
    expect(sig).toMatch(/^0x[0-9a-f]{128}$/i);
  });

  it("produces a signature that the matching public key verifies", async () => {
    await generateAndStoreSessionKeypair(SA);
    const kp = await getStoredSessionKeypair(SA);
    const digestHex = "0x" + "de".repeat(32);
    const sig = await signUserOpHash(SA, digestHex);

    const sigBytes = hexToBytes(sig);
    const digestBytes = hexToBytes(digestHex);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      kp!.publicKey,
      sigBytes.buffer as ArrayBuffer,
      digestBytes.buffer as ArrayBuffer
    );
    expect(ok).toBe(true);
  });

  it("rejects wrong-length digests", async () => {
    await generateAndStoreSessionKeypair(SA);
    await expect(signUserOpHash(SA, "0xabcd")).rejects.toThrow(
      /must be 32 bytes/
    );
  });

  it("throws when no keypair is stored (user must re-grant session)", async () => {
    await expect(
      signUserOpHash(SA, "0x" + "00".repeat(32))
    ).rejects.toThrow(/must re-grant/);
  });
});

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
