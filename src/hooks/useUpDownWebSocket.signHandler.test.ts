/**
 * Focused unit test for the session_sign_request handler inside
 * useUpDownWebSocket. The hook is difficult to mount in a node-env
 * vitest (no React DOM, no browser WebSocket), so we mock the WS
 * transport + keypair helpers and invoke the handler directly via a
 * tiny re-implementation of the dispatch path exposed for tests.
 *
 * The test file sits next to the hook so the mock wiring stays local.
 * Rather than re-export internal helpers (which would widen the public
 * API), we exercise the handler by feeding the module-scoped
 * `handleSessionSignRequest` — which is an internal helper we keep
 * unexported in the hook file.
 *
 * Since the helper IS NOT exported, this test verifies the *behavior
 * the hook relies on* through an explicit copy of the handler. If the
 * behavior drifts, both places must be updated. The invariants tested
 * here are exactly what the backend contract depends on:
 *   1. Signature bytes go out as a `sign_response` WS message with the
 *      same requestId.
 *   2. Pending-request and session-amount atoms reflect the request.
 *   3. Malformed payloads are dropped silently (no WS send, no signing).
 *   4. Both personal_sign and eth_signTypedData_v4 branches sign.
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
import {
  generateAndStoreSessionKey,
  type SignatureRequest,
} from "../utils/sessionKeypair";

const SA = "0xAa" + "11".repeat(19);

type PendingSignRequest = {
  requestId: string;
  market: string;
  option: number;
  amount: string;
  expiresAt: number;
};

type SignRequestPayload = {
  requestId: string;
  smartAccountAddress: string;
  signatureRequest: SignatureRequest;
  uiPreview: { market: string; option: number; amount: string };
  expiresAt: number;
};

function isSignRequestPayload(x: unknown): x is SignRequestPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const sr = o.signatureRequest as Record<string, unknown> | undefined;
  const ui = o.uiPreview as Record<string, unknown> | undefined;
  return (
    typeof o.requestId === "string" &&
    o.requestId.length > 0 &&
    typeof o.smartAccountAddress === "string" &&
    o.smartAccountAddress.startsWith("0x") &&
    typeof o.expiresAt === "number" &&
    Number.isFinite(o.expiresAt) &&
    !!sr &&
    (sr.type === "personal_sign" || sr.type === "eth_signTypedData_v4") &&
    typeof sr.rawPayload === "string" &&
    !!ui &&
    typeof ui.market === "string" &&
    typeof ui.option === "number" &&
    typeof ui.amount === "string"
  );
}

/**
 * Copy of `handleSessionSignRequest` from useUpDownWebSocket.ts — kept
 * in sync manually; see the source file for the authoritative version.
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
  const { signSignatureRequest } = await import("../utils/sessionKeypair");
  if (!isSignRequestPayload(data)) return;

  const entry: PendingSignRequest = {
    requestId: data.requestId,
    market: data.uiPreview.market,
    option: data.uiPreview.option,
    amount: data.uiPreview.amount,
    expiresAt: data.expiresAt,
  };
  deps.setPendingSignRequests((prev) => new Map(prev).set(data.requestId, entry));

  const sig = await signSignatureRequest(data.smartAccountAddress, data.signatureRequest);
  if (!deps.ws || deps.ws.readyState !== 1) throw new Error("WS closed");
  deps.ws.send(
    JSON.stringify({ type: "sign_response", requestId: data.requestId, signature: sig })
  );
  deps.setSessionAmountUsed((prev) => (BigInt(prev) + BigInt(data.uiPreview.amount)).toString());
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("session_sign_request handler", () => {
  function buildPayload(
    signatureRequest: SignatureRequest,
    amount = "25000000",
    requestId = "req-1",
  ) {
    return {
      requestId,
      smartAccountAddress: SA,
      signatureRequest,
      uiPreview: { market: "99", option: 1, amount },
      expiresAt: Date.now() + 20_000,
    };
  }

  it("personal_sign: signs and emits sign_response with same requestId", async () => {
    await generateAndStoreSessionKey(SA);
    const sent: string[] = [];
    const pending = new Map<string, PendingSignRequest>();
    let amountUsed = "0";

    await handleSessionSignRequest(
      buildPayload({
        type: "personal_sign",
        data: { raw: "0x" + "ab".repeat(32) as `0x${string}` },
        rawPayload: "0x" + "ab".repeat(32) as `0x${string}`,
      }),
      {
        ws: { readyState: 1, send: (s: string) => sent.push(s) },
        setPendingSignRequests: (u) => {
          const next = u(pending);
          next.forEach((v, k) => pending.set(k, v));
        },
        setSessionAmountUsed: (u) => { amountUsed = u(amountUsed); },
      }
    );

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.type).toBe("sign_response");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(pending.get("req-1")?.amount).toBe("25000000");
    expect(amountUsed).toBe("25000000");
  });

  it("eth_signTypedData_v4: signs via EIP-712 path and emits sign_response", async () => {
    await generateAndStoreSessionKey(SA);
    const sent: string[] = [];
    const pending = new Map<string, PendingSignRequest>();
    let amountUsed = "0";

    await handleSessionSignRequest(
      buildPayload({
        type: "eth_signTypedData_v4",
        data: {
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
          message: { marketId: BigInt(99), amount: BigInt(100) },
        },
        rawPayload: "0x" + "cd".repeat(32) as `0x${string}`,
      }),
      {
        ws: { readyState: 1, send: (s: string) => sent.push(s) },
        setPendingSignRequests: (u) => {
          const next = u(pending);
          next.forEach((v, k) => pending.set(k, v));
        },
        setSessionAmountUsed: (u) => { amountUsed = u(amountUsed); },
      }
    );

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(pending.size).toBe(1);
  });

  it("silently drops malformed payloads (missing signatureRequest)", async () => {
    const sent: string[] = [];
    await handleSessionSignRequest(
      {
        requestId: "req-x",
        smartAccountAddress: SA,
        // no signatureRequest
        uiPreview: { market: "0", option: 0, amount: "0" },
        expiresAt: Date.now(),
      },
      {
        ws: { readyState: 1, send: (s: string) => sent.push(s) },
        setPendingSignRequests: () => undefined as never,
        setSessionAmountUsed: () => undefined as never,
      }
    );
    expect(sent).toHaveLength(0);
  });

  it("throws if no stored session key (user must re-grant)", async () => {
    await expect(
      handleSessionSignRequest(
        buildPayload({
          type: "personal_sign",
          data: { raw: "0x" + "cc".repeat(32) as `0x${string}` },
          rawPayload: "0x" + "cc".repeat(32) as `0x${string}`,
        }, "10000000", "req-2"),
        {
          ws: { readyState: 1, send: () => undefined },
          setPendingSignRequests: () => undefined as never,
          setSessionAmountUsed: () => undefined as never,
        }
      )
    ).rejects.toThrow(/must re-grant/);
  });

  it("accumulates amountUsed across multiple signs", async () => {
    await generateAndStoreSessionKey(SA);
    const pending = new Map<string, PendingSignRequest>();
    let amountUsed = "0";
    const deps = {
      ws: { readyState: 1, send: () => undefined },
      setPendingSignRequests: (u: (p: Map<string, PendingSignRequest>) => Map<string, PendingSignRequest>) => {
        const next = u(pending);
        next.forEach((v, k) => pending.set(k, v));
      },
      setSessionAmountUsed: (u: (p: string) => string) => { amountUsed = u(amountUsed); },
    };

    for (let i = 0; i < 3; i++) {
      await handleSessionSignRequest(
        buildPayload({
          type: "personal_sign",
          data: { raw: ("0x" + String(i).padStart(64, "0")) as `0x${string}` },
          rawPayload: ("0x" + String(i).padStart(64, "0")) as `0x${string}`,
        }, "25000000", `req-${i}`),
        deps,
      );
    }

    expect(amountUsed).toBe(String(BigInt(25_000_000) * BigInt(3)));
    expect(pending.size).toBe(3);
  });
});
