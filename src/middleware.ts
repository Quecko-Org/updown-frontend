import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_RESTRICTED_COUNTRIES } from "@/lib/geo";

/**
 * Edge-level geo gate. Replaces the launch-day client-side ipapi.co
 * lookup as the authoritative check — the SPA's `useGeoCheck` is now a
 * fallback for environments where this header isn't present (local
 * dev, non-CloudFront previews).
 *
 * Strategy:
 *
 *   1. Read `CloudFront-Viewer-Country` (or the Vercel-style fallback
 *      so the same code works in preview deploys).
 *   2. If the visitor's country is in the restricted list, return a
 *      451 with a static HTML body. JS never loads, the trading UI
 *      never renders.
 *   3. Otherwise, pass-through and stamp a short-lived `pp-country`
 *      cookie so the client doesn't have to run the ipapi probe.
 *
 * The blocked-list source of truth stays in `lib/geo.ts` so the
 * middleware and the client-side belt agree. Override per-deploy via
 * `NEXT_PUBLIC_RESTRICTED_COUNTRIES` (comma-separated ISO-3166 codes).
 */

function loadRestrictedCountries(): readonly string[] {
  const raw = process.env.NEXT_PUBLIC_RESTRICTED_COUNTRIES?.trim();
  if (raw && raw.length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
  }
  return DEFAULT_RESTRICTED_COUNTRIES;
}

const RESTRICTED = loadRestrictedCountries();

/** Inline blocked-page HTML. Mirrors the copy from GeoBlockOverlay so a
 *  user with JS disabled still gets a coherent message. */
function blockedHtml(country: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Not available — PulsePairs</title><style>html,body{margin:0;padding:0;background:#0b0d10;color:#e8e9eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}h1{font-size:28px;margin:0 0 12px;font-weight:600}p{max-width:520px;color:#a8acb3;line-height:1.55;margin:0 0 8px}a{color:#7ec3ff;text-decoration:none}a:hover{text-decoration:underline}</style></head><body><main><h1>PulsePairs is not available in your region</h1><p>Detected country: <strong>${country}</strong>. This restriction is in place to comply with applicable laws and regulations.</p><p>If you believe you’ve reached this page in error, contact <a href="mailto:hello@pulsepairs.com">hello@pulsepairs.com</a>.</p></main></body></html>`;
}

export function middleware(req: NextRequest): NextResponse {
  const headerCountry =
    req.headers.get("cloudfront-viewer-country") ??
    req.headers.get("x-vercel-ip-country") ??
    "";
  const country = headerCountry.trim().toUpperCase();

  if (country && RESTRICTED.includes(country)) {
    return new NextResponse(blockedHtml(country), {
      status: 451,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const response = NextResponse.next();
  if (country) {
    response.cookies.set("pp-country", country, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
    });
  }
  return response;
}

/** Skip static assets and Next.js internals — only run on real page requests. */
export const config = {
  matcher: [
    "/((?!_next/|api/|favicon.ico|logo/|icon.png|manifest.webmanifest).*)",
  ],
};
