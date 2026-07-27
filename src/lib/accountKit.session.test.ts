import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  effectiveExpirySec,
  encodeApprove,
  MAX_UINT256,
  readOrderSession,
  UpDownAccountKitSigner,
  type OrderSessionRecord,
} from "./accountKit";

const SCA = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const KEY = `updown:oskey:${SCA}`;
const PRIV = ("0x" + "ab".repeat(32)) as `0x${string}`;

/** Minimal localStorage — the vitest env is `node`, so there isn't one. */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

function record(over: Partial<OrderSessionRecord> = {}): OrderSessionRecord {
  const now = Math.floor(Date.now() / 1000);
  return { v: 1, privateKey: PRIV, entityId: 7, createdSec: now, expirySec: now + DAY, ...over };
}

let store: Map<string, string>;

beforeEach(() => {
  store = installLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ───────── F4: the approval must be bounded, not unconditionally infinite ───────── */

describe("encodeApprove", () => {
  const AMOUNT = BigInt(10_000) * BigInt(10) ** BigInt(6);

  it("encodes the amount it was given — a bounded approval is expressible at all", () => {
    const data = encodeApprove(SPENDER, AMOUNT);
    expect(data.slice(0, 10)).toBe("0x095ea7b3");
    expect(data.slice(10, 74)).toBe(SPENDER.slice(2).padStart(64, "0"));
    expect(BigInt("0x" + data.slice(74))).toBe(AMOUNT);
  });

  it("caps the loss from a hostile spender at the approved amount, not the balance", () => {
    expect(BigInt("0x" + encodeApprove(SPENDER, AMOUNT).slice(74))).toBeLessThan(MAX_UINT256);
  });

  it("keeps MAX_UINT256 as the no-amount default (SDK parity)", () => {
    expect(BigInt("0x" + encodeApprove(SPENDER).slice(74))).toBe(MAX_UINT256);
  });

  it("encodes a zero amount rather than silently substituting MAX", () => {
    // `?? MAX_UINT256` (not `|| MAX_UINT256`) — 0n is falsy, and an allowance
    // reset to 0 must not become an infinite approval.
    expect(BigInt("0x" + encodeApprove(SPENDER, BigInt(0)).slice(74))).toBe(BigInt(0));
  });
});

/* ───────── F3a: the TTL must be a real ceiling, not a value we ask the disk to respect ───────── */

describe("effectiveExpirySec", () => {
  const now = 1_800_000_000;

  it("honours an untampered record's own expiry", () => {
    expect(effectiveExpirySec(record({ createdSec: now, expirySec: now + HOUR }), now)).toBe(
      now + HOUR,
    );
  });

  it("refuses to honour a post-dated expirySec beyond the TTL from creation", () => {
    const rec = record({ createdSec: now, expirySec: now + 100 * 365 * DAY });
    expect(effectiveExpirySec(rec, now)).toBe(now + DAY);
  });

  it("refuses to honour a record that also forges createdSec into the future", () => {
    // createdSec is clamped to now, so no record is ever honoured past now + TTL.
    const rec = record({ createdSec: now + 100 * 365 * DAY, expirySec: now + 100 * 365 * DAY });
    expect(effectiveExpirySec(rec, now)).toBe(now + DAY);
  });

  it("never honours any record more than one TTL past now, whatever it claims", () => {
    for (const createdSec of [0, now - DAY, now, now + 999 * DAY]) {
      for (const expirySec of [now + DAY, now + 999 * DAY, Number.MAX_SAFE_INTEGER]) {
        expect(effectiveExpirySec(record({ createdSec, expirySec }), now)).toBeLessThanOrEqual(
          now + DAY,
        );
      }
    }
  });

  it("still ages out a legacy record with no createdSec via its own expiry", () => {
    const rec = record({ createdSec: undefined, expirySec: now - 1 });
    expect(effectiveExpirySec(rec, now)).toBeLessThan(now);
  });
});

describe("readOrderSession", () => {
  it("returns a live session (the popup-less reload path must keep working)", () => {
    store.set(KEY, JSON.stringify(record()));
    expect(readOrderSession(SCA)?.privateKey).toBe(PRIV);
  });

  it("accepts a legacy record with no createdSec — upgrading must not force a popup", () => {
    const now = Math.floor(Date.now() / 1000);
    store.set(KEY, JSON.stringify({ v: 1, privateKey: PRIV, entityId: 7, expirySec: now + HOUR }));
    expect(readOrderSession(SCA)?.entityId).toBe(7);
  });

  it("drops a record post-dated past the TTL instead of honouring it", () => {
    const now = Math.floor(Date.now() / 1000);
    store.set(KEY, JSON.stringify(record({ createdSec: now - 2 * DAY, expirySec: now + 999 * DAY })));
    expect(readOrderSession(SCA)).toBeNull();
    expect(store.has(KEY)).toBe(false); // and erases it from disk
  });
});

/* ───────── F3a headline: "disconnect" must not leave a live signing key on disk ───────── */

describe("UpDownAccountKitSigner.disconnect", () => {
  function connectedSigner(): UpDownAccountKitSigner {
    const ak = new UpDownAccountKitSigner({
      walletClient: { request: async () => undefined },
      alchemyApiKey: "test",
      chain: { id: 42161 } as never,
    });
    // Stand in for a completed connect() — that path needs a live wallet + bundler.
    (ak as unknown as { _address: string })._address = SCA;
    (ak as unknown as { _client: unknown })._client = {};
    return ak;
  }

  it("clears the persisted session key — a disconnected wallet has no signer on disk", () => {
    store.set(KEY, JSON.stringify(record()));
    connectedSigner().disconnect();
    expect(store.has(KEY)).toBe(false);
  });

  it("leaves no in-memory session handle behind either", () => {
    store.set(KEY, JSON.stringify(record()));
    const ak = connectedSigner();
    ak.disconnect();
    expect((ak as unknown as { _session: unknown })._session).toBeNull();
    expect((ak as unknown as { _sessionClient: unknown })._sessionClient).toBeNull();
  });

  it("clears the key BEFORE dropping _address, which the storage key is derived from", () => {
    // Ordering regression guard: revoke reads `this._address`, so nulling the
    // address first would silently make disconnect a no-op on disk.
    store.set(KEY, JSON.stringify(record()));
    const ak = connectedSigner();
    ak.disconnect();
    expect(store.size).toBe(0);
    expect(() => ak.address).toThrow(/Not connected/);
  });

  it("does not touch a session key belonging to a different account", () => {
    const otherKey = "updown:oskey:0x9999999999999999999999999999999999999999";
    store.set(KEY, JSON.stringify(record()));
    store.set(otherKey, JSON.stringify(record()));
    connectedSigner().disconnect();
    expect(store.has(otherKey)).toBe(true);
  });

  it("is a no-op on a signer that never connected — the reload path must not wipe the key", () => {
    // A page load that settles on wagmi `disconnected` calls disconnect() on a
    // signer with no _address; the on-disk key must survive for the next connect.
    store.set(KEY, JSON.stringify(record()));
    const ak = new UpDownAccountKitSigner({
      walletClient: { request: async () => undefined },
      alchemyApiKey: "test",
      chain: { id: 42161 } as never,
    });
    ak.disconnect();
    expect(store.has(KEY)).toBe(true);
    expect(readOrderSession(SCA)?.privateKey).toBe(PRIV);
  });
});
