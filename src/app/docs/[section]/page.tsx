import { notFound } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { DocsMarkdown } from "@/components/DocsMarkdown";
import { API_BASE } from "@/lib/env";

type Section = "api" | "sdk";

const SECTIONS: Record<Section, { title: string; file: string }> = {
  api: { title: "API Reference", file: "api.md" },
  sdk: { title: "TypeScript SDK", file: "sdk-readme.md" },
};

function isValidSection(s: string): s is Section {
  return s === "api" || s === "sdk";
}

// 2026-05-17 PR-I: docs/api.md ported from the canonical backend template
// (updown-backend/docs/api.md, PR-5 rewrite). Frontend re-uses the same
// `{{PLACEHOLDER}}` Mustache substitution scheme as
// `updown-backend/scripts/inject-config-into-docs.mjs` so the rendered
// page auto-tracks whatever deployment the frontend targets. Placeholders
// like `{{USDT_ADDRESS}}`, `{{SETTLEMENT_ADDRESS}}`, `{{CHAIN_NAME}}`
// resolve against the live `/config` + `/version` at build time.
function chainName(chainId: number): string {
  if (chainId === 421614) return "Arbitrum Sepolia";
  if (chainId === 42161) return "Arbitrum One";
  return `chain ${chainId}`;
}
function tokenSymbol(chainId: number): string {
  return chainId === 421614 ? "USDTM" : "USDT";
}
function nativeSymbol(_chainId: number): string {
  // Both Arbitrum chains use ETH as native gas token.
  return "ETH";
}

type LiveConfig = {
  chainId?: number;
  usdtAddress?: string;
  relayerAddress?: string;
  thinWalletFactoryAddress?: string;
  settlementAddress?: string;
  chainlinkResolverAddress?: string;
  pairs?: Array<{ settlementAddress?: string; autocyclerAddress?: string }>;
};
type LiveVersion = { commit?: string; bootedAt?: string; env?: string };

async function fetchLiveConfig(): Promise<{ cfg: LiveConfig; ver: LiveVersion }> {
  // SSR-side fetches at build time (generateStaticParams pre-renders the
  // two doc sections). If the backend is unreachable at build (CI without
  // network, etc.), fall back to empty objects — placeholders will remain
  // visible as `{{TOKEN}}` so the gap is obvious to a reader, not silently
  // resolved to wrong values.
  try {
    const [cfgRes, verRes] = await Promise.all([
      fetch(`${API_BASE}/config`, { cache: "no-store" }),
      fetch(`${API_BASE}/version`, { cache: "no-store" }),
    ]);
    const cfg = cfgRes.ok ? ((await cfgRes.json()) as LiveConfig) : {};
    const ver = verRes.ok ? ((await verRes.json()) as LiveVersion) : {};
    return { cfg, ver };
  } catch {
    return { cfg: {}, ver: {} };
  }
}

function substitutePlaceholders(template: string, cfg: LiveConfig, ver: LiveVersion): string {
  const pair0 = cfg.pairs?.[0] ?? {};
  const subs: Record<string, string> = {
    CHAIN_ID: cfg.chainId != null ? String(cfg.chainId) : "{{CHAIN_ID}}",
    CHAIN_NAME: cfg.chainId != null ? chainName(cfg.chainId) : "{{CHAIN_NAME}}",
    NATIVE_SYMBOL: cfg.chainId != null ? nativeSymbol(cfg.chainId) : "{{NATIVE_SYMBOL}}",
    USDT_SYMBOL: cfg.chainId != null ? tokenSymbol(cfg.chainId) : "{{USDT_SYMBOL}}",
    USDT_ADDRESS: cfg.usdtAddress ?? "{{USDT_ADDRESS}}",
    SETTLEMENT_ADDRESS: pair0.settlementAddress ?? cfg.settlementAddress ?? "{{SETTLEMENT_ADDRESS}}",
    AUTOCYCLER_ADDRESS: pair0.autocyclerAddress ?? "{{AUTOCYCLER_ADDRESS}}",
    // Frontend extension over the backend inject script: prefer
    // `cfg.chainlinkResolverAddress` (live from /config) when env unset,
    // so docs don't leak `{{RESOLVER_ADDRESS}}` on a normal Amplify build.
    RESOLVER_ADDRESS:
      process.env.RESOLVER_ADDRESS ?? cfg.chainlinkResolverAddress ?? "{{RESOLVER_ADDRESS}}",
    THIN_WALLET_FACTORY_ADDRESS: cfg.thinWalletFactoryAddress ?? "{{THIN_WALLET_FACTORY_ADDRESS}}",
    RELAYER_ADDRESS: cfg.relayerAddress ?? "{{RELAYER_ADDRESS}}",
    COMMIT: ver.commit ?? "(unknown)",
    BOOTED_AT: ver.bootedAt ?? "(unknown)",
    ENV: ver.env ?? "(unknown)",
  };
  let out = template;
  for (const [key, value] of Object.entries(subs)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return out;
}

// Read the template at build time. Page is a Server Component +
// generateStaticParams pre-renders both sections, so the fs read +
// placeholder substitution happen ONCE at build per section. The legacy
// stripped AUTO-COPIED header isn't present on the post-PR-I template
// but the regex is harmless if the older file ever resurfaces.
async function loadMarkdown(file: string): Promise<string> {
  const filePath = path.join(process.cwd(), "src", "content", "docs", file);
  const src = fs.readFileSync(filePath, "utf8");
  const stripped = src.replace(/^<!--\s*AUTO-COPIED[^]*?-->\s*\n/, "");
  if (file !== "api.md") return stripped;
  const { cfg, ver } = await fetchLiveConfig();
  return substitutePlaceholders(stripped, cfg, ver);
}

// Statically pre-render both sections — there are only two and they're
// fully static. Avoids any runtime fs hit in production.
export function generateStaticParams() {
  return [{ section: "api" }, { section: "sdk" }];
}

// Reject any other /docs/<x> at the route boundary so /docs/bogus 404s in
// production rather than running the page handler. Defense-in-depth: the
// page also calls notFound() on an invalid section, but turning off
// dynamicParams short-circuits before page code runs at all.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  if (!isValidSection(section)) return { title: "Docs | PulsePairs" };
  return { title: `${SECTIONS[section].title} | PulsePairs` };
}

export default async function DocsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isValidSection(section)) notFound();
  const md = await loadMarkdown(SECTIONS[section].file);
  return <DocsMarkdown source={md} />;
}
