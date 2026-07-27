/**
 * Client-side pin for the two server-supplied addresses that reach user funds.
 *
 * `GET /config` and `GET /markets` are the ONLY source for the EIP-712 domain
 * (`chainId` + `verifyingContract`) and for the settlement we hand to
 * `USDT.approve`. Both branches of TradeForm's
 * `parsedKey?.settlement ?? cfg.eip712.domain.verifyingContract` are server data:
 * `parsedKey.settlement` is parsed out of the `{settlementAddress}-{marketId}`
 * composite that `GET /markets` returns (lib/marketKey). So a compromised backend
 * that serves ONE crafted market key can (a) collect order signatures bound to a
 * domain it chose and (b) collect a USDT allowance to an address it chose. This
 * module is the client-side check that closes that, and it must run BEFORE any
 * signature or approval leaves the browser.
 *
 * Two tiers, deliberately:
 *
 *   1. CHAIN PIN — always on, no configuration. `CHAIN_ID` is compiled into the
 *      bundle, so a server-supplied `eip712.domain.chainId` that disagrees with
 *      it is either a misconfigured box or a hostile /config trying to make us
 *      sign for another chain. Free to enforce and cannot brick a correctly
 *      configured deployment. (lib/wsAuth already pins its domain the same way.)
 *
 *   2. ADDRESS PIN — opt-in via `NEXT_PUBLIC_ALLOWED_SETTLEMENTS` /
 *      `NEXT_PUBLIC_ALLOWED_USDT` (comma-separated, any case). MUST be
 *      env-derived, never a literal in this file: UpDownSettlement is IMMUTABLE,
 *      so every settlement change is a redeploy at a new address (the demo stack
 *      has already moved twice), and the testnet box runs a different settlement
 *      AND a different collateral token than the demo box. A compiled-in list
 *      would brick whichever box it did not name, on the next redeploy.
 *
 * An EMPTY list means "not armed" — by default the check is skipped with a loud
 * one-time warning rather than rejecting everything. That keeps the live boxes
 * (neither of which sets these vars today) working, at the cost of making the
 * control default-off: arming it for real money is a deploy step, not a code
 * change. Same shape as the `NONE` geo sentinel in lib/geo.
 *
 *   3. FAIL-CLOSED SWITCH — `NEXT_PUBLIC_REQUIRE_ADDRESS_PIN=1` flips the empty
 *      list from "warn and skip" to "throw". A real-money mainnet build sets it,
 *      so it CANNOT ship with the pin unarmed: if the addresses were also
 *      forgotten, signing/approval hard-fails loudly instead of running
 *      unprotected.
 *
 *      We deliberately do NOT key this off `NODE_ENV === "production"`, even
 *      though that is where a fail-closed control belongs. `next build`
 *      (`npm run build`) forces `NODE_ENV=production` into the CLIENT bundle for
 *      EVERY box — including the demo and testnet stacks, whose *backends* run
 *      `NODE_ENV=development` but whose FE is still a production `next build`.
 *      Gating on `NODE_ENV` would therefore brick those two live boxes on their
 *      next rebuild (they do not set the allowlists today). The chain — 42161 —
 *      is shared between the demo stack and a real mainnet deploy, so it cannot
 *      distinguish them either. A dedicated opt-in flag is the only signal that
 *      arms real money without bricking demo/testnet: the existing boxes never
 *      set it, and the mainnet runbook does.
 */

import { CHAIN_ID } from "./env";

export type PinnedLists = {
  /** Allowed settlement / EIP-712 `verifyingContract` addresses, lowercased. Empty ⇒ not armed. */
  settlements: ReadonlySet<string>;
  /** Allowed collateral-token addresses, lowercased. Empty ⇒ not armed. */
  usdt: ReadonlySet<string>;
};

/** Split a comma-separated env list into a lowercased set. Non-addresses are dropped. */
export function parseAllowlist(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[0-9a-f]{40}$/.test(s)),
  );
}

/**
 * Read the allowlists from the build-time env. Read per call (not frozen at
 * module load) purely so tests can vary them — Next inlines the literal
 * `process.env.NEXT_PUBLIC_*` references at build either way, so a runtime API
 * response can never move these.
 */
export function readPinnedLists(): PinnedLists {
  return {
    settlements: parseAllowlist(process.env.NEXT_PUBLIC_ALLOWED_SETTLEMENTS),
    usdt: parseAllowlist(process.env.NEXT_PUBLIC_ALLOWED_USDT),
  };
}

/**
 * Fail-closed switch: when set, an EMPTY allowlist throws instead of warn-and-skip.
 * A real-money mainnet build sets this so it cannot ship with the pin unarmed.
 * NOT keyed off NODE_ENV — see the module header for why that would brick the
 * demo/testnet boxes (whose FE is still a production `next build`).
 */
export function pinRequired(): boolean {
  const v = process.env.NEXT_PUBLIC_REQUIRE_ADDRESS_PIN?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** One warning per list per page life — this sits on the hot signing path. */
const warned = new Set<string>();

function warnUnarmed(which: string): void {
  if (warned.has(which)) return;
  warned.add(which);
  console.warn(
    `[pinnedAddresses] ${which} allowlist is empty — server-supplied ${which} addresses are NOT pinned. ` +
      `Set NEXT_PUBLIC_ALLOWED_SETTLEMENTS / NEXT_PUBLIC_ALLOWED_USDT to arm this check.`,
  );
}

/** Test seam: forget which warnings have already fired. */
export function __resetPinWarnings(): void {
  warned.clear();
}

function assertAllowed(
  which: "settlement" | "usdt",
  address: string,
  allowed: ReadonlySet<string>,
  requirePin: boolean,
): void {
  if (allowed.size === 0) {
    if (requirePin) {
      throw new Error(
        `Refusing to use ${which} ${address}: the ${which} allowlist is empty but ` +
          `NEXT_PUBLIC_REQUIRE_ADDRESS_PIN is set — this build must pin its ` +
          `funds-reaching addresses. Set NEXT_PUBLIC_ALLOWED_SETTLEMENTS / ` +
          `NEXT_PUBLIC_ALLOWED_USDT to the box's GET /config verifyingContract and USDT spender.`,
      );
    }
    warnUnarmed(which);
    return;
  }
  if (!allowed.has(address.toLowerCase())) {
    throw new Error(
      `Refusing to use ${which} ${address}: it is not in this build's allowlist. ` +
        `The API returned an address this frontend was not deployed to trust.`,
    );
  }
}

/**
 * Guard the EIP-712 domain we are about to sign against. Throws — callers must
 * NOT fall back to signing anyway.
 *
 * `chainId` is compared against the compiled-in `CHAIN_ID`, not merely echoed:
 * a signature carrying a foreign chainId is replayable on that chain, so the
 * server's opinion of which chain we are on is not authoritative.
 */
export function assertPinnedDomain(
  domain: { chainId: number; verifyingContract: string },
  opts?: { expectedChainId?: number; lists?: PinnedLists; requirePin?: boolean },
): void {
  const expected = opts?.expectedChainId ?? CHAIN_ID;
  if (domain.chainId !== expected) {
    throw new Error(
      `Refusing to sign for chain ${domain.chainId}: this app is built for chain ${expected}. ` +
        `The API returned a different chain than the one it is configured for.`,
    );
  }
  assertAllowed(
    "settlement",
    domain.verifyingContract,
    (opts?.lists ?? readPinnedLists()).settlements,
    opts?.requirePin ?? pinRequired(),
  );
}

/**
 * Guard the (token, spender) pair we are about to grant an allowance to.
 * Throws — an approval to an unpinned spender is the total-loss path.
 */
export function assertPinnedApproval(
  args: { settlement: string; usdt: string },
  opts?: { lists?: PinnedLists; requirePin?: boolean },
): void {
  const lists = opts?.lists ?? readPinnedLists();
  const requirePin = opts?.requirePin ?? pinRequired();
  assertAllowed("settlement", args.settlement, lists.settlements, requirePin);
  assertAllowed("usdt", args.usdt, lists.usdt, requirePin);
}
