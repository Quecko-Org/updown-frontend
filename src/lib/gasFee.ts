/**
 * Sponsored-transfer gas fee — ported from the Resolution Center
 * (`resolution-center/src/core/rain/gas-fee.ts`, docs/GAS-FEE-TRANSFER-REFACTOR.md,
 * 2026-06-08) and adapted to UpDown's single-collateral model.
 *
 * WHY THIS EXISTS (the whole point):
 * Alchemy's ERC-20 paymaster can only debit tokens on its own supported registry —
 * it prices them, so it needs a real market rate. The demo settles in rain's
 * "USDT Mock", which has no rate, and the Gas Manager rejects it outright:
 *   `Sponsorship failed: unsupported token address 0xCa4f77…`  (verified 2026-07-15)
 * So "charge the user gas in the token they trade with" is IMPOSSIBLE via the
 * ERC-20 paymaster for any mock/unlisted token.
 *
 * The way around it, which is what Rain asked the Resolution Center to build:
 *   1. a SPONSORSHIP-type policy pays the ETH gas (no token pricing involved —
 *      so the user needs ZERO ETH), then
 *   2. we estimate what that gas cost, convert ETH → the fee token ourselves via
 *      Chainlink, and batch a plain `transfer(collector, fee)` into the SAME
 *      userOp as the action.
 * Alchemy never touches the token, so ANY ERC-20 works — mock included.
 *
 * SECURITY: the transfer is a call WE assemble, not an on-chain-enforced charge.
 * A SPONSORSHIP policy cannot require it, so a hand-rolled userOp can omit the
 * fee and still get gas sponsored. This is best-effort billing, exactly as in the
 * Resolution Center (its §6/§11). Do not present it as enforced.
 */

import { createPublicClient, http, parseAbi, encodeFunctionData, formatUnits, toHex, type Address, type Hex } from "viem";

import { activeChain, ALCHEMY_RPC_URL } from "@/config/environment";

const AGGREGATOR_ABI = parseAbi(["function latestAnswer() view returns (int256)"]);
const ERC20_TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** Chainlink ETH/USD on Arbitrum One (8 decimals). */
const CHAINLINK_ETH_USD: Address = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612";
/** $1.00 at 8 decimals — the fallback for USD-pegged tokens with no feed (our USDTm). */
const USD_PEG_8 = BigInt(100_000_000);

/** Address that receives the gas-equivalent fee. Unset → sponsorship is FREE. */
export const GAS_FEE_COLLECTOR = process.env.NEXT_PUBLIC_GAS_FEE_COLLECTOR?.trim() as Address | undefined;

/**
 * Safety buffer over the live estimate, absorbing gas-price drift between quote
 * and execution. 2000bps = +20%. Whoever sponsors eats any residual shortfall.
 */
export const GAS_FEE_MARKUP_BPS = BigInt(process.env.NEXT_PUBLIC_GAS_FEE_MARKUP_BPS ?? "2000");

/**
 * FALLBACK gas-units budget, used only when the real per-userOp estimate fails.
 * Sized to UpDown's heaviest onboarding userOp (approve + MA-v2 session-entity
 * install + Arbitrum L1 preVerification). Deliberately conservative: overcharging
 * a demo is recoverable, undercharging silently bills us.
 */
export const GAS_FEE_UNITS_ESTIMATE = BigInt(process.env.NEXT_PUBLIC_GAS_FEE_UNITS ?? "900000");

/**
 * Fraction of the bundler's committed gas LIMITS we charge. 10000bps = 1.0.
 *
 * Keep this at 1.0. The Resolution Center learned it the hard way: a 0.65
 * discount assumed ~1.6–1.9× limit-vs-used padding, the bundler later tightened
 * to ~1.2×, and the discount started UNDERCHARGING. Gas used can never exceed the
 * userOp's committed limits (it reverts first), so charging the full limits can
 * never undercharge no matter how padding drifts.
 */
export const GAS_FEE_LIMIT_FACTOR_BPS = BigInt(process.env.NEXT_PUBLIC_GAS_FEE_LIMIT_FACTOR_BPS ?? "10000");

export type Call = { to: Address; data: Hex; value?: bigint };

export interface GasFeeQuote {
  feeToken: Address;
  feeDecimals: number;
  feeRaw: bigint;
  /** The transfer(collector, feeRaw) call to batch into the userOp. */
  transfer: Call;
  breakdown: {
    gasUnits: bigint;
    gasPriceWei: bigint;
    ethUsd8: bigint;
    tokenUsd8: bigint;
    markupBps: bigint;
    estimateSource: "prepared-userop" | "fixed-budget";
  };
}

function publicClient() {
  return createPublicClient({ chain: activeChain, transport: http(ALCHEMY_RPC_URL) });
}

/**
 * Sum the gas-limit fields of a prepared v0.7 userOp. These scale with the
 * action and include Arbitrum's L1-data preVerification, so they track real cost
 * where a fixed budget can't. Returns 0n if the shape isn't recognized.
 */
function sumUserOpGasLimits(prepared: unknown): bigint {
  const d = (prepared as { data?: Record<string, unknown> } | undefined)?.data;
  if (!d) return BigInt(0);
  let sum = BigInt(0);
  for (const f of [
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    "paymasterVerificationGasLimit",
    "paymasterPostOpGasLimit",
  ]) {
    const v = d[f];
    if (v != null) {
      try {
        sum += BigInt(v as string);
      } catch {
        /* skip unparseable field */
      }
    }
  }
  return sum;
}

async function readChainlink8(feed: Address): Promise<bigint> {
  const ans = (await publicClient().readContract({
    address: feed,
    abi: AGGREGATOR_ABI,
    functionName: "latestAnswer",
  })) as bigint;
  if (ans <= BigInt(0)) throw new Error(`Chainlink feed ${feed} returned ${ans}`);
  return ans;
}

/**
 * Quote the gas-equivalent fee for one userOp and build the ERC-20 transfer that
 * collects it. Fail-closed: throws if pricing fails, so a caller can never
 * silently fall back to a free (unbilled) send.
 *
 * @param client        the smart wallet client (for the prepareCalls probe)
 * @param from          the SCA
 * @param policyId      the SPONSORSHIP policy paying the ETH
 * @param feeToken      token to charge in (the demo's USDTm)
 * @param actionCalls   the real calls, so the estimate covers the whole batch
 */
export async function computeGasFeeTransfer(opts: {
  client?: { prepareCalls?: (args: unknown) => Promise<unknown> };
  from?: Address;
  policyId?: string;
  feeToken: Address;
  feeDecimals?: number;
  actionCalls?: Call[];
  onLog?: (m: string) => void;
}): Promise<GasFeeQuote> {
  if (!GAS_FEE_COLLECTOR) {
    throw new Error(
      "Network-fee collector is not configured (NEXT_PUBLIC_GAS_FEE_COLLECTOR). " +
        "Cannot charge the gas fee in sponsored-transfer mode.",
    );
  }
  const feeDecimals = opts.feeDecimals ?? 6;

  // The live gas PRICE — NOT estimateFeesPerGas().maxFeePerGas, which is a ~1.2×
  // ceiling the tx never actually pays (charging on it overcharges ~1.2×).
  let gasPriceWei: bigint;
  try {
    gasPriceWei = await publicClient().getGasPrice();
  } catch {
    const fees = await publicClient().estimateFeesPerGas();
    gasPriceWei = fees.maxFeePerGas ?? BigInt(0);
  }

  // Prefer the REAL per-userOp estimate so the fee scales with the action.
  let gasUnits = GAS_FEE_UNITS_ESTIMATE;
  let estimateSource: "prepared-userop" | "fixed-budget" = "fixed-budget";
  if (opts.client?.prepareCalls && opts.from && opts.policyId && opts.actionCalls?.length) {
    try {
      // Probe with a placeholder amount of 1 — transfer gas is amount-independent,
      // which breaks the chicken-and-egg (we need the gas to know the fee, and the
      // fee to build the transfer).
      const probe = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [GAS_FEE_COLLECTOR, BigInt(1)],
      });
      const prepared = await opts.client.prepareCalls({
        from: opts.from,
        calls: [
          { to: opts.feeToken, data: probe, value: toHex(BigInt(0)) },
          ...opts.actionCalls.map((c) => ({ to: c.to, data: c.data, value: toHex(c.value ?? BigInt(0)) })),
        ],
        capabilities: { paymasterService: { policyId: opts.policyId } },
      });
      const sum = sumUserOpGasLimits(prepared);
      if (sum > BigInt(0)) {
        gasUnits = (sum * GAS_FEE_LIMIT_FACTOR_BPS) / BigInt(10_000);
        estimateSource = "prepared-userop";
      }
    } catch (e) {
      opts.onLog?.(
        `[gasFee] prepareCalls estimate failed (${(e as Error)?.message}); using fixed budget ${GAS_FEE_UNITS_ESTIMATE}`,
      );
    }
  }

  const gasWei = gasUnits * gasPriceWei;
  const ethUsd8 = await readChainlink8(CHAINLINK_ETH_USD);
  // The demo's USDTm is a $1-pegged mock with no feed → the peg IS the price.
  const tokenUsd8 = USD_PEG_8;

  // feeRaw = gasWei × (ETH/USD) × 10^dec × (10000 + markup)
  //          ────────────────────────────────────────────────
  //                10^18 × (token/USD) × 10000
  // The 1e8 Chainlink scale cancels; 1e18 converts wei→ETH; 10^dec scales into
  // the fee token's base units.
  const numerator = gasWei * ethUsd8 * BigInt(10) ** BigInt(feeDecimals) * (BigInt(10_000) + GAS_FEE_MARKUP_BPS);
  const denominator = BigInt(10) ** BigInt(18) * tokenUsd8 * BigInt(10_000);
  const feeRaw = numerator / denominator;

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [GAS_FEE_COLLECTOR, feeRaw],
  });

  opts.onLog?.(
    `[gasFee] ≈ ${formatUnits(feeRaw, feeDecimals)} USDTm — ${gasUnits} gas (${estimateSource}) × ${gasPriceWei} wei, ` +
      `ETH/USD ${formatUnits(ethUsd8, 8)}, +${GAS_FEE_MARKUP_BPS}bps → ${GAS_FEE_COLLECTOR}`,
  );

  return {
    feeToken: opts.feeToken,
    feeDecimals,
    feeRaw,
    transfer: { to: opts.feeToken, data, value: BigInt(0) },
    breakdown: { gasUnits, gasPriceWei, ethUsd8, tokenUsd8, markupBps: GAS_FEE_MARKUP_BPS, estimateSource },
  };
}
