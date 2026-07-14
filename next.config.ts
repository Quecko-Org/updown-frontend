import type { NextConfig } from "next";

// Static, origin-independent response headers. These four constrain how the browser
// treats OUR document; none of them restrict outbound connections, so they cannot
// break a wallet connector, an RPC call, or an Account Kit UserOp. The outbound
// controls (CSP connect-src/frame-src) are deliberately NOT here — the origin list is
// not derivable from source (Account Kit reaches api.segment.io transitively via
// @account-kit/logging, and wagmi's bare http() for mainnet resolves to a viem
// built-in default RPC that can move on a patch bump), so an enforcing CSP has to be
// earned with a Report-Only collection period rather than guessed.
//
// These live in next.config.ts and NOT in middleware.ts on purpose: the middleware
// matcher excludes `_next/`, so headers set there would miss every JS and CSS asset.
const securityHeaders = [
  // Block MIME sniffing: a response we serve as JSON must never be re-interpreted
  // as HTML/script by content inspection.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Full URL same-origin, bare origin cross-origin. Keeps market/wallet identifiers
  // that appear in the path out of third-party referer logs.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // DENY rather than SAMEORIGIN: the rain.trade integration ships as an SDK, not an
  // iframe embed, so nothing legitimately frames this app. This governs OUR page being
  // framed and does not affect the wallet iframes we HOST (keys.coinbase.com,
  // verify.walletconnect.com) — those are inbound frames, a frame-src concern.
  // If an embed is ever planned, this becomes SAMEORIGIN / CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // includeSubDomains is deliberately omitted: these apps are served from hosts under
  // rainwins.com, and asserting HSTS for the whole subdomain tree would force HTTPS on
  // sibling hosts this deployment does not own. `preload` is likewise omitted — it is
  // effectively irreversible. Redundant if the edge already sets this; harmless when
  // it does, since the stricter max-age wins.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  transpilePackages: [
    "@account-kit/react",
    "@account-kit/core",
    "@account-kit/infra",
    "@account-kit/signer",
    "@account-kit/smart-contracts",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
