/**
 * Phase 4c — ThinWallet consumer flow end-to-end integration test.
 *
 * Runs the FULL Phase 4 user flow against the live dev backend on Sepolia,
 * via the real public HTTP API. No browser, no wallet extension — pure
 * viem (the frontend's actual web3 stack).
 *
 * Steps:
 *   [1] Generate fresh test EOA via viem/accounts
 *   [2] Sign verify-wallet personal_sign over the lowercased EOA address
 *   [3] POST /thin-wallet/provision → backend relayer deploys the TW
 *   [4] Verify TW on-chain: getCode + owner() readback
 *   [5] Build executeWithSig envelope for USDTM.approve(Settlement, MAX),
 *       sign against TW's EIP-712 domain
 *   [6] POST /thin-wallet/execute-with-sig → backend relayer broadcasts
 *   [7] Verify allowance on-chain: USDTM.allowance(TW, Settlement) === MAX
 *   [8] Build a Settlement-domain order digest, wrap in WalletAuth typed-
 *       data against TW's domain, sign with the EOA's key
 *   [9] POST /orders with maker = TW address + WalletAuth-wrapped sig
 *  [10] Backend accepts the signature (may reject downstream on economic
 *       grounds — TW has no USDTM balance — which is fine; we're
 *       validating the signature handling path, not trade execution)
 *
 * Run: `npx playwright test e2e/phase-4c-thin-wallet-integration.spec.ts`
 */

import { test, expect } from "@playwright/test";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hashTypedData,
  http,
  maxUint256,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API = process.env.PHASE4C_API_BASE ?? "https://dev-api.pulsepairs.com";
const ALCHEMY_RPC = "https://arb-sepolia.g.alchemy.com/v2/m1ZDZF0NDLbqkK-we12g0";

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "market", type: "uint256" },
    { name: "option", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "type", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

async function getCodeWithRetry(
  client: ReturnType<typeof createPublicClient>,
  addr: `0x${string}`,
  maxTries = 8,
): Promise<string> {
  for (let i = 0; i < maxTries; i++) {
    const c = await client.getBytecode({ address: addr });
    if (c && c.length > 2) return c;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "0x";
}

function randomUint256AsString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

test.describe("Phase 4c — ThinWallet consumer flow against dev (Sepolia)", () => {
  test.setTimeout(120_000);

  test("provision + executeWithSig approve + WalletAuth-signed order accepted by backend", async () => {
    // ── [1] Fresh test EOA ─────────────────────────────────────
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    console.log(`[i] test EOA: ${account.address}`);

    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(ALCHEMY_RPC),
    });

    // /config readback
    const cfgRes = await fetch(`${API}/config`);
    const cfg = (await cfgRes.json()) as {
      chainId: number;
      usdtAddress: string;
      pairs: Array<{ pairId: string; settlementAddress: string }>;
      eip712: { domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` } };
      thinWalletFactoryAddress?: string;
    };
    expect(cfg.chainId).toBe(421614);
    expect(cfg.thinWalletFactoryAddress).toBeTruthy();

    // ── [2] verify-wallet personal_sign ────────────────────────
    const verifySig = await account.signMessage({ message: account.address.toLowerCase() });

    // ── [3] POST /thin-wallet/provision ────────────────────────
    const provRes = await fetch(`${API}/thin-wallet/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eoa: account.address, signature: verifySig }),
    });
    expect(provRes.status).toBe(200);
    const prov = (await provRes.json()) as { twAddress: `0x${string}`; deployed: boolean; txHash?: string };
    expect(prov.deployed).toBe(true);
    expect(prov.twAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(prov.txHash).toBeTruthy();
    const twAddress = getAddress(prov.twAddress);
    console.log(`[3] TW provisioned: ${twAddress} (tx ${prov.txHash})`);

    // ── [4] On-chain readback ──────────────────────────────────
    const code = await getCodeWithRetry(publicClient, twAddress);
    expect(code.length).toBeGreaterThan(2);
    const owner = (await publicClient.readContract({
      address: twAddress,
      abi: [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
      functionName: "owner",
    })) as `0x${string}`;
    expect(owner.toLowerCase()).toBe(account.address.toLowerCase());

    // ── [5] ExecuteWithSig envelope: USDTM.approve(Settlement, MAX) ─
    const SETTLEMENT = getAddress(cfg.pairs[0]!.settlementAddress);
    const USDTM = getAddress(cfg.usdtAddress);
    const approveCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [SETTLEMENT, maxUint256],
    });
    const nonceStr = randomUint256AsString();
    const deadline = Math.floor(Date.now() / 1000) + 600;

    const twDomain = {
      name: "PulsePairsThinWallet",
      version: "1",
      chainId: cfg.chainId,
      verifyingContract: twAddress,
    } as const;
    const execTypes = {
      ExecuteWithSig: [
        { name: "target", type: "address" },
        { name: "data", type: "bytes" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;

    const execSig = await account.signTypedData({
      domain: twDomain,
      types: execTypes,
      primaryType: "ExecuteWithSig",
      message: {
        target: USDTM,
        data: approveCalldata,
        nonce: BigInt(nonceStr),
        deadline: BigInt(deadline),
      },
    });

    // ── [6] POST /thin-wallet/execute-with-sig ─────────────────
    const execRes = await fetch(`${API}/thin-wallet/execute-with-sig`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eoa: account.address,
        signedAuth: {
          target: USDTM,
          data: approveCalldata,
          nonce: nonceStr,
          deadline,
          signature: execSig,
        },
      }),
    });
    expect(execRes.status).toBe(200);
    const exec = (await execRes.json()) as { txHash: string; blockNumber: number };
    expect(exec.txHash).toBeTruthy();
    console.log(`[6] approve broadcast: tx ${exec.txHash} block ${exec.blockNumber}`);

    // ── [7] On-chain allowance check ───────────────────────────
    await new Promise((r) => setTimeout(r, 3000));
    const allowance = (await publicClient.readContract({
      address: USDTM,
      abi: erc20Abi,
      functionName: "allowance",
      args: [twAddress, SETTLEMENT],
    })) as bigint;
    expect(allowance).toBe(maxUint256);
    console.log(`[7] USDTM.allowance(TW, Settlement) = MaxUint256 ✓`);

    // ── [8] WalletAuth-signed order ────────────────────────────
    const marketsRes = await fetch(`${API}/markets?status=ACTIVE`);
    const marketsJson = (await marketsRes.json()) as unknown;
    const markets = Array.isArray(marketsJson)
      ? marketsJson
      : ((marketsJson as { markets?: unknown[] }).markets ?? []);
    expect(markets.length).toBeGreaterThan(0);
    const market = markets[0] as { address: string; marketId?: number; id?: number };
    const idSuffix = market.address.split("-").pop()!;
    const marketId = BigInt(market.marketId ?? market.id ?? idSuffix);

    const orderMsg = {
      maker: twAddress,
      market: marketId,
      option: BigInt(1),
      side: 0,
      type: 1,
      price: BigInt(0),
      amount: BigInt(5_000_000),
      nonce: BigInt(Math.floor(Date.now() / 1000)),
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const orderDigest = hashTypedData({
      domain: cfg.eip712.domain,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: orderMsg,
    });

    const walletAuthTypes = { WalletAuth: [{ name: "hash", type: "bytes32" }] } as const;
    const walletAuthSig = await account.signTypedData({
      domain: twDomain,
      types: walletAuthTypes,
      primaryType: "WalletAuth",
      message: { hash: orderDigest },
    });

    // ── [9] POST /orders ────────────────────────────────────────
    const orderRes = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maker: orderMsg.maker,
        market: market.address,
        option: 1,
        side: 0,
        type: 1,
        price: 0,
        amount: orderMsg.amount.toString(),
        nonce: orderMsg.nonce.toString(),
        expiry: Number(orderMsg.expiry),
        signature: walletAuthSig,
      }),
    });
    const orderJson = (await orderRes.json()) as Record<string, unknown>;
    console.log(`[9] POST /orders status=${orderRes.status} body=${JSON.stringify(orderJson).slice(0, 200)}`);

    // ── [10] Signature acceptance gate ──────────────────────────
    if (orderRes.status >= 400) {
      const body = JSON.stringify(orderJson).toLowerCase();
      expect(body).not.toMatch(/(invalid signature|bad signature|signature.*invalid|recovered)/);
      // Economic rejection reasons are acceptable — TW has 0 USDTM.
      const economic = /balance|stake|amount|usdt|insufficient|locked|inorders|funds/;
      expect(body).toMatch(economic);
      console.log(`[10] order rejected on economic grounds (signature path validated) ✓`);
    } else {
      console.log(`[10] order accepted end-to-end ✓`);
    }
  });
});
