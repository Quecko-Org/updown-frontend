"use client";

/**
 * Alchemy Account Kit (smart-contract account, "SCA") custody for UpDown.
 *
 * Replaces the Phase-4 ThinWallet: the user's trading identity is now an
 * Alchemy SCA derived deterministically from their owner EOA — the SAME
 * config rain.trade's `RainAA` uses (same chain + alchemyApiKey [+ policy]),
 * so the same owner EOA resolves to the same SCA across both products.
 *
 * This is a vendored copy of `@updown/sdk`'s `UpDownAccountKitSigner`
 * (sdk/typescript/src/accountKit.ts), minus the SDK's ws-auth helper (the FE
 * builds WsAuth typed-data in `lib/wsAuth.ts`) — keep the two in sync until
 * the package is published and this file becomes an import.
 *
 * The two hard rules (UPDOWN_SATELLITE_CHANGE_DESIGN.md §2):
 *   1. Orders/cancels MUST be bare ERC-1271 (6492 wrapper stripped) — the
 *      on-chain OZ SignatureChecker cannot parse 6492 blobs.
 *   2. The SCA MUST be deployed before its first fill (`onboard()` = one
 *      UserOp: deploy + approve settlement).
 * WS-auth is the one place the RAW (possibly 6492-wrapped) signature is used
 * on purpose: the backend verifies off-chain with viem `verifyTypedData`,
 * which validates counterfactual 6492 sigs — so private channels work even
 * before the SCA is deployed. Nothing on-chain ever sees that signature.
 *
 * Gas modes (config-driven, see `createUpDownAccountKitSigner`):
 *   - no policyId          → SELF-PAID UserOps (SCA must hold a little ETH;
 *                            the dev faucet seeds it). Demo default.
 *   - policyId only        → app-sponsored (sponsorship-type policy).
 *   - policyId + gasToken  → user pays gas in that token (ERC-20-type
 *                            policy; the current `fed14eaa…` policy is this
 *                            type with USDC allowed).
 */
import {
  decodeAbiParameters,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
} from "viem";
import { activeChain, ALCHEMY_API_KEY, ALCHEMY_RPC_URL } from "@/config/environment";

/* ───────────────────────── EIP-6492 unwrap ───────────────────────── */

const ERC6492_MAGIC =
  "6492649264926492649264926492649264926492649264926492649264926492";

export function isErc6492Signature(signature: Hex): boolean {
  return signature.length >= 66 && signature.slice(-64).toLowerCase() === ERC6492_MAGIC;
}

/** Return the BARE inner signature from an EIP-6492-wrapped blob, or the
 *  input unchanged if not wrapped. */
export function stripErc6492Wrapper(signature: Hex): Hex {
  if (!isErc6492Signature(signature)) return signature;
  const body = ("0x" + signature.slice(2, signature.length - 64)) as Hex;
  const [, , inner] = decodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
    body,
  ) as [Address, Hex, Hex];
  return inner;
}

/* ───────────────────────── The signer class ───────────────────────── */

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

export type UpDownAccountKitConfig = {
  walletClient: Eip1193Provider;
  alchemyApiKey: string;
  paymasterPolicyId?: string;
  gasToken?: { tokenAddress: Address };
  chain: Chain;
  rpcUrl?: string;
};

/** Shared SCA-address cache key (identical to rain.trade's `useRain`). */
function saCacheKey(eoa: string): string {
  return `rain:sa:${eoa.toLowerCase()}`;
}

function writeCachedSA(eoa: string, addr: string): void {
  try {
    localStorage.setItem(saCacheKey(eoa), addr);
  } catch {
    /* private mode / SSR — best effort */
  }
}

export class UpDownAccountKitSigner {
  private readonly config: UpDownAccountKitConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _account: any = null;
  private _address: Address | null = null;
  private _ownerEoa: Address | null = null;

  constructor(config: UpDownAccountKitConfig) {
    if (!config.walletClient) throw new Error("walletClient (owner EIP-1193 provider) is required");
    if (!config.alchemyApiKey) throw new Error("alchemyApiKey is required");
    if (!config.chain) throw new Error("chain is required");
    this.config = config;
  }

  /** Create the owner smart-wallet client and resolve the SCA address. */
  async connect(): Promise<Address> {
    if (this._address && this._client) return this._address;

    const [aaCore, infraMod, walletClientLib] = await Promise.all([
      import("@aa-sdk/core"),
      import("@account-kit/infra"),
      import("@account-kit/wallet-client"),
    ]);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { WalletClientSigner } = aaCore as any;
    const { alchemy, defineAlchemyChain } = infraMod as any;
    const { createSmartWalletClient } = walletClientLib as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const { createWalletClient, custom } = await import("viem");

    const alchemyChain = defineAlchemyChain({
      chain: this.config.chain,
      rpcBaseUrl: `https://${this.config.chain.id === 42161 ? "arb-mainnet" : "arb-sepolia"}.g.alchemy.com/v2`,
    });

    const eoaSigner = new WalletClientSigner(
      createWalletClient({ transport: custom(this.config.walletClient) }),
      "wallet",
    );

    const eoaClient = createSmartWalletClient({
      chain: alchemyChain,
      signer: eoaSigner,
      ...(this.config.paymasterPolicyId ? { policyId: this.config.paymasterPolicyId } : {}),
      transport: alchemy({ apiKey: this.config.alchemyApiKey, nodeRpcUrl: this.config.rpcUrl }),
    });

    const account = await eoaClient.requestAccount();
    if (!account?.address) throw new Error("Failed to resolve Alchemy smart account");

    this._client = eoaClient;
    this._account = account;
    this._address = account.address as Address;
    this._ownerEoa = (await eoaSigner.getAddress()) as Address;
    writeCachedSA(this._ownerEoa, this._address);
    return this._address;
  }

  /** The SCA address — `order.maker`, the deposit address, the ERC-1271 signer. */
  get address(): Address {
    if (!this._address) throw new Error("Not connected. Call connect() first.");
    return this._address;
  }

  get ownerEoa(): Address {
    if (!this._ownerEoa) throw new Error("Not connected. Call connect() first.");
    return this._ownerEoa;
  }

  /**
   * Owner-signed EIP-712 typed data, returned RAW — possibly 6492-wrapped when
   * the SCA is not yet deployed. ONLY for off-chain verifiers that understand
   * 6492 (the backend's viem `verifyTypedData`, i.e. WS-auth). Never for orders.
   */
  async signTypedDataRaw(typedData: TypedDataDefinition): Promise<Hex> {
    if (!this._client || !this._address) throw new Error("Not connected. Call connect() first.");
    return (await this._client.signTypedData({
      ...typedData,
      account: this._address,
    })) as Hex;
  }

  /**
   * Owner-signed EIP-712 typed data as a BARE ERC-1271 signature (6492
   * stripped). The ONLY signing path for orders and cancels. The SCA must be
   * deployed (`onboard`) before the signature is used in a fill.
   */
  async signTypedDataBare(typedData: TypedDataDefinition): Promise<Hex> {
    return stripErc6492Wrapper(await this.signTypedDataRaw(typedData));
  }

  /** True iff the SCA has bytecode on-chain (deploy-before-fill precondition). */
  async isDeployed(publicClient: PublicClient): Promise<boolean> {
    if (!this._address) throw new Error("Not connected. Call connect() first.");
    const code = await publicClient.getBytecode({ address: this._address });
    return !!code && code !== "0x";
  }

  /**
   * One-time onboarding: DEPLOY the SCA and `approve(settlement, USDT, MAX)`
   * in a single UserOp (deployment rides the account init-code). Satisfies
   * deploy-before-fill + the allowance `enterPosition` needs.
   */
  async onboard(args: { usdt: Address; settlement: Address }): Promise<Hex> {
    return this.sendCall({ to: args.usdt, data: encodeApprove(args.settlement) });
  }

  /** Transfer USDT out of the SCA to `to` (UserOp). */
  async withdraw(args: { usdt: Address; to: Address; amount: bigint }): Promise<Hex> {
    return this.sendCall({ to: args.usdt, data: encodeTransfer(args.to, args.amount) });
  }

  /** Send a single call from the SCA as a UserOp; returns the tx hash. */
  async sendCall(call: { to: Address; data: Hex; value?: bigint }): Promise<Hex> {
    if (!this._client || !this._account || !this._address) {
      throw new Error("Not connected. Call connect() first.");
    }
    const { toHex } = await import("viem");
    const capabilities: Record<string, unknown> = {};
    if (this.config.paymasterPolicyId && this.config.gasToken) {
      capabilities.paymasterService = {
        policyId: this.config.paymasterPolicyId,
        erc20: {
          tokenAddress: this.config.gasToken.tokenAddress,
          postOpSettings: { autoApprove: true },
        },
      };
    }
    const { id } = await this._client.sendCalls({
      from: this._address,
      calls: [{ to: call.to, data: call.data, value: toHex(call.value ?? BigInt(0)) }],
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
    });
    const status = await this._client.waitForCallsStatus({ id });
    const txHash = status.receipts?.[0]?.transactionHash as Hex | undefined;
    if (!txHash) throw new Error(`UserOp ${id} returned no transaction hash`);
    return txHash;
  }

  disconnect(): void {
    this._client = null;
    this._account = null;
    this._address = null;
    this._ownerEoa = null;
  }
}

/* ───────────────────────── calldata encoders ───────────────────────── */

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

function encodeApprove(spender: Address): Hex {
  // approve(address,uint256) selector 0x095ea7b3
  return ("0x095ea7b3" + pad(spender) + pad(MAX_UINT256)) as Hex;
}

function encodeTransfer(to: Address, amount: bigint): Hex {
  // transfer(address,uint256) selector 0xa9059cbb
  return ("0xa9059cbb" + pad(to) + pad(amount)) as Hex;
}

function pad(v: Address | bigint): string {
  const hex = typeof v === "bigint" ? v.toString(16) : v.toLowerCase().replace(/^0x/, "");
  return hex.padStart(64, "0");
}

/* ───────────────────────── FE factory ───────────────────────── */

/**
 * Build the signer from the FE env + the connected wagmi connector's
 * EIP-1193 provider. Gas mode is env-driven:
 *   NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID unset → self-paid (demo default)
 *   …set                                    → sponsored
 *   …set + NEXT_PUBLIC_AK_GAS_TOKEN set     → ERC-20-paid (e.g. USDC)
 */
export function createUpDownAccountKitSigner(provider: Eip1193Provider): UpDownAccountKitSigner {
  const policyId = process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID?.trim();
  const gasTokenAddr = process.env.NEXT_PUBLIC_AK_GAS_TOKEN?.trim();
  return new UpDownAccountKitSigner({
    walletClient: provider,
    alchemyApiKey: ALCHEMY_API_KEY,
    ...(policyId ? { paymasterPolicyId: policyId } : {}),
    ...(policyId && gasTokenAddr ? { gasToken: { tokenAddress: gasTokenAddr as Address } } : {}),
    chain: activeChain,
    rpcUrl: ALCHEMY_RPC_URL,
  });
}
