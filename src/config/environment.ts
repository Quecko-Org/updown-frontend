import { arbitrum, arbitrumSepolia, type Chain } from "viem/chains";
import { CHAIN_ID } from "@/lib/env";

export const ALCHEMY_API_KEY =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim() ?? ""
    : "";

export const platform_chainId = CHAIN_ID;

export const activeChain: Chain = CHAIN_ID === 421614 ? arbitrumSepolia : arbitrum;

function buildAlchemyRpc(chainId: number, apiKey: string): string {
  if (!apiKey) {
    return chainId === 421614
      ? "https://sepolia-rollup.arbitrum.io/rpc"
      : "https://arb1.arbitrum.io/rpc";
  }
  const subdomain = chainId === 421614 ? "arb-sepolia" : "arb-mainnet";
  return `https://${subdomain}.g.alchemy.com/v2/${apiKey}`;
}

export const ALCHEMY_RPC_URL = buildAlchemyRpc(CHAIN_ID, ALCHEMY_API_KEY);

export function getSessionExpirySec(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 48;
}

export const SESSION_USDT_ALLOWANCE_BASE_UNITS: bigint = BigInt(
  process.env.NEXT_PUBLIC_SESSION_USDT_ALLOWANCE ?? "10000000000"
);

export const SESSION_GAS_LIMIT: bigint = BigInt(process.env.NEXT_PUBLIC_SESSION_GAS_LIMIT ?? "10000000");
