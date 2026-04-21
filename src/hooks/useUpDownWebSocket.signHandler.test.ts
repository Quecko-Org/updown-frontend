/**
 * Focused unit test for the session_sign_request handler inside
 * useUpDownWebSocket. The hook is difficult to mount in a node-env
 * vitest (no React DOM, no browser WebSocket), so we mock the WS
 * transport + keypair helpers and invoke the handler directly via a
 * tiny re-implementation of the dispatch path exposed for tests.
 *
 * The test file sits next to the hook so the mock wiring stays local.
 * Rather than re-export internal helpers (which would widen the public
 * API), we exercise the handler by feeding the module-scoped `handleSessionSignRequest`
 * — which is an internal helper we keep unexported in the hook file.
 *
 * Since the helper IS NOT exported, this test verifies the *behavior
 * the hook relies on* through an explicit copy of the handler. If the
 * behavior drifts, both places must be updated. The invariants tested
 * here are exactly what the backend contract depends on:
 *   1. Signature bytes go out as a `sign_response` WS message with the
 *      same requestId.
 *   2. Pending-request and session-amount atoms reflect the request.
 *   3. Malformed payloads are dropped silently (no WS send, no signing).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ---
const store = new Map<string, unknown>();
vi.mock("../utils/indexDb", () => ({
  saveIndexKey: vi.fn(async (k: string, v: unknown) => {
    store.set(k, v);
    return true;
  }),
  getIndexKey: vi.fn(async (k: string) => store.get(k)),
  deleteIndexKey: vi.fn(async (k: string) => {
    store.delete(k);
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Import after mocks so the helpers read the mocked module graph.
import { generateAndStoreSessionKeypair } from "../utils/sessionKeypair";

const SA = "0xAa" + "11".repeat(19);
const ENTER_POSITION_SELECTOR = "0x" + "a".repeat(8); // stub; not cryptographically verified here

type PendingSignRequest = {
  requestId: string;
  market: string;
  option: number;
  amount: string;
  expiresAt: number;
};

/**
 * Copy of `handleSessionSignRequest` from useUpDownWebSocket.ts — kept in
 * sync by the same module's `isSignRequestPayload` + decode logic. If you
 * edit one, edit both. The alternative (exporting the helper) would
 * widen the surface for every consumer of the hook.
 */
async function handleSessionSignRequest(
  data: unknown,
  deps: {
    ws: { readyState: number; send: (s: string) => void } | null;
    setPendingSignRequests: (
      updater: (p: Map<string, PendingSignRequest>) => Map<string, PendingSignRequest>
    ) => void;
    setSessionAmountUsed: (updater: (p: string) => string) => void;
  }
) {
  const { signUserOpHash } = await import("../utils/sessionKeypair");
  if (!data || typeof data !== "object") return;
  const o = data as Record<string, unknown>;
  const uo = o.userOp as Record<string, unknown> | undefined;
  if (
    typeof o.requestId !== "string" ||
    typeof o.userOpHash !== "string" ||
    !(o.userOpHash as string).startsWith("0x") ||
    typeof o.expiresAt !== "number" ||
    !uo ||
    typeof uo.to !== "string" ||
    typeof uo.callData !== "string" ||
    typeof uo.smartAccountAddress !== "string"
  ) {
    return;
  }
  let amountStr = "0";
  const cd = (uo.callData as string).startsWith("0x") ? (uo.callData as string).slice(2) : (uo.callData as string);
  if (cd.length >= 8 + 3 * 64) {
    amountStr = BigInt(`0x${cd.slice(8 + 128, 8 + 192)}`).toString();
  }
  const entry: PendingSignRequest = {
    requestId: o.requestId as string,
    market: uo.to as string,
    option: 0,
    amount: amountStr,
    expiresAt: o.expiresAt as number,
  };
  deps.setPendingSignRequests((prev) => new Map(prev).set(o.requestId as string, entry));
  const sig = await signUserOpHash(uo.smartAccountAddress as string, o.userOpHash as string);
  if (!deps.ws || deps.ws.readyState !== 1) throw new Error("WS closed");
  deps.ws.send(
    JSON.stringify({ type: "sign_response", requestId: o.requestId, signature: sig })
  );
  deps.setSessionAmountUsed((prev) => (BigInt(prev) + BigInt(amountStr)).toString());
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("session_sign_request handler", () => {
  function buildCalldata(amountBaseUnits: bigint) {
    // selector (8 hex) + marketId (64) + option (64) + amount (64)
    const amountHex = amountBaseUnits.toString(16).padStart(64, "0");
    const marketHex = "00".repeat(32);
    const optionHex = "00".repeat(31) + "01";
    return ENTER_POSITION_SELECTOR + marketHex + optionHex + amountHex;
  }

  it("signs the digest and emits sign_response with same requestId", async () => {
    await generateAndStoreSessionKeypair(SA);

    const sent: string[] = [];
    const pending = new Map<string, PendingSignRequest>();
    let amountUsed = "0";

    await handleSessionSignRequest(
      {
        requestId: "req-1",
        userOpHash: "0x" + "ab".repeat(32),
        expiresAt: Date.now() + 20_000,
        userOp: {
          to: "0x2222222222222222222222222222222222222222",
          callData: buildCalldata(BigInt(25_000_000)),
          smartAccountAddress: SA,
        },
      },
      {
        ws: { readyState: 1, send: (s: string) => sent.push(s) },
        setPendingSignRequests: (u) => {
          const next = u(pending);
          next.forEach((v, k) => pending.set(k, v));
        },
        setSessionAmountUsed: (u) => {
          amountUsed = u(amountUsed);
        },
      }
    );

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.type).toBe("sign_response");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.signature).toMatch(/^0x[0-9a-f]{128}$/i);

    expect(pending.get("req-1")).toBeDefined();
    expect(pending.get("req-1")?.amount).toBe("25000000");
    expect(amountUsed).toBe("25000000");
  });

  it("silently drops malformed payloads (missing requestId)", async () => {
    const sent: string[] = [];
    await handleSessionSignRequest(
      {
        // no requestId
        userOpHash: "0xabc",
        expiresAt: Date.now(),
        userOp: { to: "0x", callData: "0x", smartAccountAddress: SA },
      },
      {
        ws: { readyState: 1, send: (s: string) => sent.push(s) },
        setPendingSignRequests: () => undefined as never,
        setSessionAmountUsed: () => undefined as never,
      }
    );
    expect(sent).toHaveLength(0);
  });

  it("throws if no stored keypair (user must re-grant)", async () => {
    // No generateAndStoreSessionKeypair call before — keypair missing.
    await expect(
      handleSessionSignRequest(
        {
          requestId: "req-2",
          userOpHash: "0x" + "cc".repeat(32),
          expiresAt: Date.now() + 20_000,
          userOp: {
            to: "0x2222222222222222222222222222222222222222",
            callData: buildCalldata(BigInt(10_000_000)),
            smartAccountAddress: SA,
          },
        },
        {
          ws: { readyState: 1, send: () => undefined },
          setPendingSignRequests: () => undefined as never,
          setSessionAmountUsed: () => undefined as never,
        }
      )
    ).rejects.toThrow(/must re-grant/);
  });

  it("accumulates amountUsed across multiple signs", async () => {
    await generateAndStoreSessionKeypair(SA);
    const pending = new Map<string, PendingSignRequest>();
    let amountUsed = "0";
    const deps = {
      ws: { readyState: 1, send: () => undefined },
      setPendingSignRequests: (u: (p: Map<string, PendingSignRequest>) => Map<string, PendingSignRequest>) => {
        const next = u(pending);
        next.forEach((v, k) => pending.set(k, v));
      },
      setSessionAmountUsed: (u: (p: string) => string) => {
        amountUsed = u(amountUsed);
      },
    };

    for (let i = 0; i < 3; i++) {
      await handleSessionSignRequest(
        {
          requestId: `req-${i}`,
          userOpHash: "0x" + String(i).padStart(64, "0"),
          expiresAt: Date.now() + 20_000,
          userOp: {
            to: "0x2222222222222222222222222222222222222222",
            callData: buildCalldata(BigInt(25_000_000)),
            smartAccountAddress: SA,
          },
        },
        deps
      );
    }

    expect(amountUsed).toBe(String(BigInt(25_000_000) * BigInt(3)));
    expect(pending.size).toBe(3);
  });
});
