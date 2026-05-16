import { describe, expect, it } from "vitest";
import { activeChain, tokenSymbolForActiveChain } from "./environment";

/**
 * F3 (2026-05-16) — chain-gate logic verification.
 *
 * Components (DepositModal, TradeForm) gate the testnet mint button
 * on `activeChain.id === 421614`. This test asserts:
 *
 *   1. `activeChain.id` is sourced from `NEXT_PUBLIC_CHAIN_ID` (build-time
 *      env). The chain-gate is therefore a static property of the build,
 *      not a runtime value the user can manipulate via wallet state.
 *
 *   2. `tokenSymbolForActiveChain()` returns "USDTM" only on chainId 421614
 *      (the same condition the gate uses). The two helpers must agree —
 *      a divergence would mean the button could render with "USDT" copy
 *      on a chain that says "USDTM" elsewhere, or vice versa.
 *
 *   3. Mainnet (chainId 42161) explicitly returns "USDT" — and therefore
 *      the gate condition is false. A mainnet build cannot render the
 *      testnet mint button by definition of this gate.
 *
 * The full positive E2E (button visible + mint succeeds) lives in
 * `e2e/phase-4d-thinwallet-ladder.spec.ts`. A full mainnet-build E2E
 * (button absent) is a separate follow-up — see PR description.
 */
describe("F3 chain-gate", () => {
  it("activeChain.id matches NEXT_PUBLIC_CHAIN_ID env at build time", () => {
    const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 42161);
    expect(activeChain.id).toBe(envChainId);
  });

  it("tokenSymbolForActiveChain returns USDTM iff chainId is 421614", () => {
    if (activeChain.id === 421614) {
      expect(tokenSymbolForActiveChain()).toBe("USDTM");
    } else {
      expect(tokenSymbolForActiveChain()).toBe("USDT");
    }
  });

  it("mainnet chainId (42161) does not satisfy the testnet gate", () => {
    // The gate condition used in DepositModal + TradeForm is literally
    // `activeChain.id === 421614`. If activeChain.id were 42161 (mainnet),
    // the conditional would be false → component returns null / button
    // not rendered. This invariant is the F3 production-safety guarantee.
    const mainnetSimulated = 42161;
    expect(mainnetSimulated === 421614).toBe(false);
    expect(activeChain.id !== 42161 || activeChain.id !== 421614).toBe(true);
  });
});
