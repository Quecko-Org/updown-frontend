import { notFound } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { DocsMarkdown } from "@/components/DocsMarkdown";

type Section = "api" | "sdk";

const SECTIONS: Record<Section, { title: string; file: string }> = {
  api: { title: "API Reference", file: "api.md" },
  sdk: { title: "TypeScript SDK", file: "sdk-readme.md" },
};

function isValidSection(s: string): s is Section {
  return s === "api" || s === "sdk";
}

// Read at request time. Page is a Server Component, so this runs on the
// server only. With pre-rendered output via generateStaticParams, the read
// happens once at build time per section.
//
// Strip the AUTO-COPIED header here (rather than inside the renderer) so the
// comment doesn't leak into the React Server Component payload that gets
// shipped for client hydration.
function loadMarkdown(file: string): string {
  // process.cwd() at runtime is the Next.js project root.
  const filePath = path.join(process.cwd(), "src", "content", "docs", file);
  const src = fs.readFileSync(filePath, "utf8");
  return src.replace(/^<!--\s*AUTO-COPIED[^]*?-->\s*\n/, "");
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
  const md = loadMarkdown(SECTIONS[section].file);
  return <DocsMarkdown source={md} />;
}
