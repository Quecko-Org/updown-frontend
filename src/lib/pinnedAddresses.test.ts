import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetPinWarnings,
  assertPinnedApproval,
  assertPinnedDomain,
  parseAllowlist,
  pinRequired,
  readPinnedLists,
  type PinnedLists,
} from "./pinnedAddresses";

const SETTLEMENT = "0xbf119b0000000000000000000000000000053ed1";
const OTHER_SETTLEMENT = "0x3554000000000000000000000000000000a7ed01";
const USDT = "0xca4f770000000000000000000000000000725f41";
const ATTACKER = "0xdead000000000000000000000000000000000001";

function lists(settlements: string[], usdt: string[]): PinnedLists {
  return { settlements: new Set(settlements), usdt: new Set(usdt) };
}

const ARMED = lists([SETTLEMENT], [USDT]);
const UNARMED = lists([], []);

afterEach(() => {
  __resetPinWarnings();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseAllowlist", () => {
  it("lowercases and splits, so env casing never decides whether an address is trusted", () => {
    const set = parseAllowlist(` ${SETTLEMENT.toUpperCase()} , ${USDT} `);
    expect(set.has(SETTLEMENT)).toBe(true);
    expect(set.has(USDT)).toBe(true);
  });

  it("treats unset/empty as not-armed rather than as a list containing garbage", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist(" , ").size).toBe(0);
  });

  it("drops non-addresses so a malformed entry cannot silently widen the list", () => {
    expect(parseAllowlist(`not-an-address,${SETTLEMENT},0x1234`)).toEqual(new Set([SETTLEMENT]));
  });
});

describe("readPinnedLists", () => {
  it("is sourced from build-time env, never from a literal in the bundle", () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_SETTLEMENTS", SETTLEMENT);
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_USDT", USDT);
    expect(readPinnedLists()).toEqual(ARMED);
  });
});

describe("pinRequired (fail-closed switch)", () => {
  it("is off unless the env flag is explicitly 1/true — demo/testnet never set it", () => {
    expect(pinRequired()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_REQUIRE_ADDRESS_PIN", "0");
    expect(pinRequired()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_REQUIRE_ADDRESS_PIN", "");
    expect(pinRequired()).toBe(false);
  });

  it("arms on 1 or true (any case), so a real-money build can force fail-closed", () => {
    vi.stubEnv("NEXT_PUBLIC_REQUIRE_ADDRESS_PIN", "1");
    expect(pinRequired()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_REQUIRE_ADDRESS_PIN", "TRUE");
    expect(pinRequired()).toBe(true);
  });
});

describe("empty allowlist: warn-and-skip vs fail-closed", () => {
  // The round-2 hole: an unarmed pin is a control that only looks armed. On the
  // demo/testnet boxes (which never set the flag) that must stay warn-and-skip so
  // a rebuild does not brick them; on a real-money mainnet build the flag makes an
  // unarmed pin THROW before any signature or allowance leaves the browser.
  it("empty + flag OFF (development/demo) SKIPS with a warning, does not throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: ATTACKER },
        { expectedChainId: 42161, lists: UNARMED, requirePin: false },
      ),
    ).not.toThrow();
    expect(() =>
      assertPinnedApproval(
        { settlement: ATTACKER, usdt: ATTACKER },
        { lists: UNARMED, requirePin: false },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("empty + flag ON (mainnet) THROWS on the domain pin — cannot ship unarmed", () => {
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: SETTLEMENT },
        { expectedChainId: 42161, lists: UNARMED, requirePin: true },
      ),
    ).toThrow(/REQUIRE_ADDRESS_PIN/);
  });

  it("empty + flag ON (mainnet) THROWS on the approval pin — the total-loss path", () => {
    expect(() =>
      assertPinnedApproval(
        { settlement: SETTLEMENT, usdt: USDT },
        { lists: UNARMED, requirePin: true },
      ),
    ).toThrow(/REQUIRE_ADDRESS_PIN/);
  });

  it("reads the flag from build-time env when requirePin is not injected", () => {
    vi.stubEnv("NEXT_PUBLIC_REQUIRE_ADDRESS_PIN", "1");
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_SETTLEMENTS", "");
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_USDT", "");
    expect(() =>
      assertPinnedDomain({ chainId: 42161, verifyingContract: SETTLEMENT }, { expectedChainId: 42161 }),
    ).toThrow(/REQUIRE_ADDRESS_PIN/);
  });

  it("an ARMED build is unaffected by the flag — a pinned address still passes", () => {
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: SETTLEMENT },
        { expectedChainId: 42161, lists: ARMED, requirePin: true },
      ),
    ).not.toThrow();
    expect(() =>
      assertPinnedApproval(
        { settlement: SETTLEMENT, usdt: USDT },
        { lists: ARMED, requirePin: true },
      ),
    ).not.toThrow();
  });
});

describe("assertPinnedDomain — chain pin (always on, no env)", () => {
  // The whole point: a signature carrying a foreign chainId is replayable on
  // that chain, so /config's opinion of our chain is not authoritative.
  for (const chainId of [42161, 421614]) {
    it(`accepts a domain whose chainId matches the compiled-in chain (${chainId})`, () => {
      expect(() =>
        assertPinnedDomain(
          { chainId, verifyingContract: SETTLEMENT },
          { expectedChainId: chainId, lists: ARMED },
        ),
      ).not.toThrow();
    });

    it(`rejects a hostile /config that cross-chains a signature away from ${chainId}`, () => {
      expect(() =>
        assertPinnedDomain(
          { chainId: 1, verifyingContract: SETTLEMENT },
          { expectedChainId: chainId, lists: ARMED },
        ),
      ).toThrow(/chain/i);
    });
  }

  it("enforces the chain even when the address allowlist is not armed", () => {
    expect(() =>
      assertPinnedDomain(
        { chainId: 999, verifyingContract: SETTLEMENT },
        { expectedChainId: 42161, lists: UNARMED },
      ),
    ).toThrow(/chain/i);
  });
});

describe("assertPinnedDomain — settlement pin", () => {
  it("rejects a verifyingContract the build was not deployed to trust", () => {
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: ATTACKER },
        { expectedChainId: 42161, lists: ARMED },
      ),
    ).toThrow(/allowlist/i);
  });

  it("is case-insensitive: a checksummed address from the API is the same address", () => {
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: SETTLEMENT.toUpperCase() },
        { expectedChainId: 42161, lists: ARMED },
      ),
    ).not.toThrow();
  });

  it("supports multiple settlements per build — an immutable contract gets redeployed", () => {
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: OTHER_SETTLEMENT },
        { expectedChainId: 42161, lists: lists([SETTLEMENT, OTHER_SETTLEMENT], [USDT]) },
      ),
    ).not.toThrow();
  });

  it("skips (with a warning) when unarmed, so a box that never set the env var still runs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: ATTACKER },
        { expectedChainId: 42161, lists: UNARMED },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("warns once per list, not once per signature — this sits on the hot signing path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: ATTACKER },
        { expectedChainId: 42161, lists: UNARMED },
      );
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the real demo addresses shipped in .env.example are self-consistent", () => {
  // Guards against a typo in the example env values: the two known-good LIVE demo
  // (Arbitrum One) addresses must parse and be ACCEPTED end-to-end via the env
  // path, and a hostile settlement/USDT/chain must be REJECTED against them.
  const DEMO_SETTLEMENT = "0xBF119BC4C3C56b78E211F8fC49C8232a3a3053ed";
  const DEMO_USDT = "0xCa4f77A38d8552Dd1D5E44e890173921B67725F4";

  it("accepts the demo settlement + USDT read from build-time env, rejects an attacker", () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_SETTLEMENTS", DEMO_SETTLEMENT);
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_USDT", DEMO_USDT);
    vi.stubEnv("NEXT_PUBLIC_REQUIRE_ADDRESS_PIN", "1");

    // legit domain + approval accepted (checksummed API casing tolerated)
    expect(() =>
      assertPinnedDomain(
        { chainId: 42161, verifyingContract: DEMO_SETTLEMENT },
        { expectedChainId: 42161 },
      ),
    ).not.toThrow();
    expect(() =>
      assertPinnedApproval({ settlement: DEMO_SETTLEMENT, usdt: DEMO_USDT }),
    ).not.toThrow();

    // hostile settlement / usdt / chain all rejected
    expect(() =>
      assertPinnedDomain({ chainId: 42161, verifyingContract: ATTACKER }, { expectedChainId: 42161 }),
    ).toThrow(/allowlist/i);
    expect(() =>
      assertPinnedApproval({ settlement: DEMO_SETTLEMENT, usdt: ATTACKER }),
    ).toThrow(/allowlist/i);
    expect(() =>
      assertPinnedDomain({ chainId: 1, verifyingContract: DEMO_SETTLEMENT }, { expectedChainId: 42161 }),
    ).toThrow(/chain/i);
  });
});

describe("assertPinnedApproval", () => {
  it("accepts the pinned (usdt, settlement) pair", () => {
    expect(() =>
      assertPinnedApproval({ settlement: SETTLEMENT, usdt: USDT }, { lists: ARMED }),
    ).not.toThrow();
  });

  // The total-loss path: a crafted composite market key from GET /markets puts an
  // attacker address in `parsedKey.settlement`, which becomes the approve spender.
  it("rejects an attacker-controlled settlement before any allowance is granted", () => {
    expect(() =>
      assertPinnedApproval({ settlement: ATTACKER, usdt: USDT }, { lists: ARMED }),
    ).toThrow(/allowlist/i);
  });

  it("rejects an attacker-controlled token — approve on a hostile token is arbitrary code", () => {
    expect(() =>
      assertPinnedApproval({ settlement: SETTLEMENT, usdt: ATTACKER }, { lists: ARMED }),
    ).toThrow(/allowlist/i);
  });

  // Each list arms exactly its own field: arming settlements must not silently
  // imply a usdt pin (that would be a control that only looks armed), and an
  // unarmed list must not borrow enforcement from the armed one.
  it("pins each list independently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // settlements armed, usdt not → settlement enforced, usdt skipped
    expect(() =>
      assertPinnedApproval({ settlement: ATTACKER, usdt: USDT }, { lists: lists([SETTLEMENT], []) }),
    ).toThrow(/allowlist/i);
    expect(() =>
      assertPinnedApproval({ settlement: SETTLEMENT, usdt: ATTACKER }, { lists: lists([SETTLEMENT], []) }),
    ).not.toThrow();
    // usdt armed, settlements not → usdt enforced, settlement skipped
    expect(() =>
      assertPinnedApproval({ settlement: ATTACKER, usdt: ATTACKER }, { lists: lists([], [USDT]) }),
    ).toThrow(/allowlist/i);
    expect(() =>
      assertPinnedApproval({ settlement: ATTACKER, usdt: USDT }, { lists: lists([], [USDT]) }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
