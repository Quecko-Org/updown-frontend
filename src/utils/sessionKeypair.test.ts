/**
 * Node's `globalThis.crypto.getRandomValues` is available in Node 20+,
 * and `viem`'s `privateKeyToAccount` works unchanged in Node. IndexedDB
 * is absent in Node, so we mock the thin K/V wrapper instead of pulling
 * in fake-indexeddb.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recoverMessageAddress,
  recoverTypedDataAddress,
  type TypedDataDefinition,
} from "viem";

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
  signSignatureRequest,
  idbKeyFor,
  type SignatureRequest,
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

describe("signSignatureRequest", () => {
  it("personal_sign with { raw } data: produces 65-byte sig that recovers to the stored address", async () => {
    const addr = await generateAndStoreSessionKey(SA);
    const rawPayload = ("0x" + "de".repeat(32)) as `0x${string}`;
    const req: SignatureRequest = {
      type: "personal_sign",
      data: { raw: rawPayload },
      rawPayload,
    };
    const sig = await signSignatureRequest(SA, req);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
    const recovered = await recoverMessageAddress({
      message: { raw: rawPayload },
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(addr.toLowerCase());
  });

  it("personal_sign with string data: UTF-8 encoded, recovers via EIP-191", async () => {
    const addr = await generateAndStoreSessionKey(SA);
    const message = "hello Alchemy";
    const req: SignatureRequest = {
      type: "personal_sign",
      data: message,
      rawPayload: ("0x" +
        Buffer.from(message, "utf8").toString("hex")) as `0x${string}`,
    };
    const sig = await signSignatureRequest(SA, req);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
    const recovered = await recoverMessageAddress({
      message,
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(addr.toLowerCase());
  });

  it("eth_signTypedData_v4: produces EIP-712 sig that recovers via recoverTypedDataAddress", async () => {
    const addr = await generateAndStoreSessionKey(SA);
    const typedData: TypedDataDefinition = {
      domain: {
        name: "UpDown Exchange",
        version: "1",
        chainId: 42161,
        verifyingContract: "0x2222222222222222222222222222222222222222",
      },
      types: {
        Settle: [
          { name: "marketId", type: "uint256" },
          { name: "amount", type: "uint256" },
        ],
      },
      primaryType: "Settle",
      message: { marketId: BigInt(99), amount: BigInt(100_000_000) },
    };
    const req: SignatureRequest = {
      type: "eth_signTypedData_v4",
      data: typedData,
      rawPayload: ("0x" + "00".repeat(32)) as `0x${string}`,
    };
    const sig = await signSignatureRequest(SA, req);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
    const recovered = await recoverTypedDataAddress({
      ...typedData,
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(addr.toLowerCase());
  });

  it("throws when no session key is stored (user must re-grant session)", async () => {
    const req: SignatureRequest = {
      type: "personal_sign",
      data: { raw: "0x00" as `0x${string}` },
      rawPayload: "0x00" as `0x${string}`,
    };
    await expect(signSignatureRequest(SA, req)).rejects.toThrow(/must re-grant/);
  });

  it("throws on unsupported signatureRequest type (defensive stop-and-page)", async () => {
    await generateAndStoreSessionKey(SA);
    // Intentionally constructing an invalid variant to cover the guard.
    const bogus = {
      type: "eip7702Auth",
      data: "whatever",
      rawPayload: "0x00",
    } as unknown as SignatureRequest;
    await expect(signSignatureRequest(SA, bogus)).rejects.toThrow(/Unsupported signatureRequest type/);
  });
});
