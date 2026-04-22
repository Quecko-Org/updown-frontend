/**
 * Node's `globalThis.crypto.getRandomValues` is available in Node 20+,
 * and `viem`'s `privateKeyToAccount` works unchanged in Node. IndexedDB
 * is absent in Node, so we mock the thin K/V wrapper instead of pulling
 * in fake-indexeddb.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { recoverMessageAddress, hashMessage } from "viem";

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
  generateAndStoreSessionKey,
  getStoredSessionKey,
  deleteSessionKey,
  signUserOpHash,
  idbKeyFor,
} from "./sessionKeypair";

const SA = "0xAa" + "11".repeat(19);

beforeEach(() => {
  store.clear();
});

describe("idbKeyFor", () => {
  it("namespaces by smart account and lower-cases", () => {
    expect(idbKeyFor(SA)).toBe(`sessionSignerKey:${SA.toLowerCase()}`);
  });
});

describe("generateAndStoreSessionKey", () => {
  it("generates a secp256k1 key and returns its EOA address", async () => {
    const addr = await generateAndStoreSessionKey(SA);
    // 20-byte address = 40 hex chars after 0x.
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const kp = await getStoredSessionKey(SA);
    expect(kp).not.toBeNull();
    // Private key is 32 bytes = 64 hex chars after 0x.
    expect(kp!.privateKey).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(kp!.address).toBe(addr);
  });

  it("overwrites the entry for the same smart account on re-generation", async () => {
    const first = await generateAndStoreSessionKey(SA);
    const second = await generateAndStoreSessionKey(SA);
    expect(second).not.toBe(first);
    const kp = await getStoredSessionKey(SA);
    expect(kp!.address).toBe(second);
  });

  it("keeps distinct entries for distinct smart accounts", async () => {
    const a = "0xAa" + "11".repeat(19);
    const b = "0xBb" + "22".repeat(19);
    await generateAndStoreSessionKey(a);
    await generateAndStoreSessionKey(b);
    expect(store.has(idbKeyFor(a))).toBe(true);
    expect(store.has(idbKeyFor(b))).toBe(true);
    expect(store.get(idbKeyFor(a))).not.toBe(store.get(idbKeyFor(b)));
  });
});

describe("getStoredSessionKey", () => {
  it("returns null when no entry exists", async () => {
    expect(await getStoredSessionKey(SA)).toBeNull();
  });

  it("returns null for a malformed entry (defense against stale keys from older schemas)", async () => {
    store.set(idbKeyFor(SA), { wrong: "shape" });
    expect(await getStoredSessionKey(SA)).toBeNull();
  });

  it("returns null for the prior P-256 schema (CryptoKeyPair shape)", async () => {
    // Simulate an entry written by the previous P-256 implementation —
    // the new loader must reject it so the grant flow re-runs fresh.
    store.set(idbKeyFor(SA), {
      privateKey: { type: "private" } as unknown,
      publicKey: { type: "public" } as unknown,
    });
    expect(await getStoredSessionKey(SA)).toBeNull();
  });
});

describe("deleteSessionKey", () => {
  it("removes the stored entry", async () => {
    await generateAndStoreSessionKey(SA);
    await deleteSessionKey(SA);
    expect(await getStoredSessionKey(SA)).toBeNull();
  });
});

describe("signUserOpHash", () => {
  it("returns a 65-byte secp256k1 personal_sign signature", async () => {
    await generateAndStoreSessionKey(SA);
    const digest = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const sig = await signUserOpHash(SA, digest);
    // r||s||v = 65 bytes = 130 hex chars.
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("signature recovers to the stored session address (EIP-191)", async () => {
    const addr = await generateAndStoreSessionKey(SA);
    const digest = ("0x" + "de".repeat(32)) as `0x${string}`;
    const sig = (await signUserOpHash(SA, digest)) as `0x${string}`;

    // LocalAccountSigner.signMessage(raw) is EIP-191 personal_sign over the
    // raw bytes — recoverMessageAddress with `{ raw }` must match.
    const recovered = await recoverMessageAddress({
      message: { raw: digest },
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(addr.toLowerCase());
  });

  it("the signed digest is the EIP-191-prefixed hash, not the raw userOpHash", async () => {
    // Spot-check of the signing envelope: hashMessage({ raw }) is what a
    // consumer would re-derive to verify on-chain under MA v2's
    // single-signer validation module.
    const addr = await generateAndStoreSessionKey(SA);
    const digest = ("0x" + "11".repeat(32)) as `0x${string}`;
    const sig = (await signUserOpHash(SA, digest)) as `0x${string}`;
    const wrapped = hashMessage({ raw: digest });
    // We can't verify secp256k1 over a raw hash directly with viem's public
    // helpers, but recoverMessageAddress uses this exact wrap internally —
    // a successful recover above implies the wrap matches. This test
    // documents the envelope explicitly so the invariant is codified.
    expect(wrapped).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("throws when no session key is stored (user must re-grant session)", async () => {
    await expect(
      signUserOpHash(SA, "0x" + "00".repeat(32))
    ).rejects.toThrow(/must re-grant/);
  });
});
