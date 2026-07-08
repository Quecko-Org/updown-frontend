# updown-frontend

Reference web client for **UpDown** (a.k.a. PulsePairs) — on-chain UP/DOWN binary
prediction markets on BTC-USD / ETH-USD over 5-minute / 15-minute / 1-hour cycles.
Next.js 15 (App Router) + wagmi/viem + Alchemy Account Kit custody.

This app is the **reference implementation** for the product being integrated
into a partner interface. It is not required to ship it as-is — the intended path
is to consume the published SDK (`@pulsepairs/sdk`) and the matcher REST/WS API,
and use this repo to copy patterns (custody wiring, order/cancel/WS-auth signing,
error-string mapping in `src/lib/errors.ts`).

- **Live demo:** https://demo-pulsepairs.rainwins.com
- **Matcher API/WS it talks to:** `https://api.demo-pulsepairs.rainwins.com` (`wss://…/stream`)
- **SDK:** [`@pulsepairs/sdk`](https://www.npmjs.com/package/@pulsepairs/sdk) on npm
- **Full integration guide + API reference:** `docs/UPDOWN_INTEGRATION.md`,
  `docs/api.md`, `docs/UPDOWN_LIFECYCLE.md` in the **updown-backend** repo.

---

## Quick start

```bash
cp .env.example .env.local     # then fill in NEXT_PUBLIC_ALCHEMY_API_KEY (see below)
npm install                    # if you hit a wagmi peer conflict: npm install --legacy-peer-deps
npm run dev                    # http://localhost:3000
```

Out of the box `.env.example` points at the public demo backend, so a dev server
with just an Alchemy key set will show live demo markets. Node **20 LTS or 22**
is recommended (the repo does not pin a version; Next.js 15 needs ≥ 18.18).

---

## Configuration

All configuration is via `NEXT_PUBLIC_*` environment variables — see
[`.env.example`](./.env.example) for the complete, commented list. The two that
matter most:

| Variable | Required? | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | **Yes** | Matcher backend base URL; the WS URL is derived from it. **If unset it silently falls back to `https://dev-api.pulsepairs.com`** — always set it. |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | **Yes** | Powers the RPC transport *and* the Account Kit signer. If blank, market data still loads on a public RPC but **onboarding and order signing throw** — set it. |
| `NEXT_PUBLIC_CHAIN_ID` | optional (42161) | Only `42161` (Arbitrum One) and `421614` (Arbitrum Sepolia) are wired. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | recommended | Supply your own; otherwise a shared PulsePairs project id is used. |
| `NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID` | optional | Presence selects gasless (sponsorship policy) vs self-paid (unset). See `.env.example`. |
| `NEXT_PUBLIC_SESSION_ORDERS` | optional (on) | Popup-less order signing; set `0` to force an owner-wallet popup per order. |
| `NEXT_PUBLIC_RESTRICTED_COUNTRIES` | optional | **Default placeholder blocks US & GB.** Set `NONE` to disable, or your own list. |

> **Build-time note:** `NEXT_PUBLIC_*` values are inlined at build time. After
> changing any of them, re-run `npm run build` — restarting a running production
> server is not enough.

### Rebranding

This build is branded "PulsePairs". Before shipping under your own brand, replace
the logo assets in `public/logo/`, the support email `hello@pulsepairs.com`, and
the copy/metadata in `src/app/layout.tsx`, `src/app/manifest.ts`, `Header.tsx`,
`Footer.tsx`, `GeoBlockOverlay.tsx`, and the static content pages. **Do not
rename** the EIP-712 WS-auth domain string `"PulsePairs WebSocket Auth"` in
`src/lib/wsAuth.ts` — it is load-bearing and must match the backend, or WS auth
breaks.

---

## How custody works (Account Kit)

The user's trading identity is an **Alchemy Modular Account v2 smart-contract
account (SCA)** derived deterministically from their owner EOA — the same Alchemy
config rain.trade uses, so one owner EOA resolves to the **same SCA address across
both products**. The SCA is the order `maker`, the deposit address, and the
ERC-1271 signer. Flow:

1. **Connect** the owner EOA (MetaMask / WalletConnect / Coinbase) → the SCA is
   derived (`connect()`), no signature or backend provisioning.
2. **Fund** the SCA with USDT (on the demo, the faucet mints test USDT to it).
3. **First trade → one onboarding UserOp** deploys the SCA, `approve`s the
   settlement contract, and installs the popup-less order-session key — **one
   owner signature total**.
4. **Orders / cancels / WS-auth** are then signed popup-less by the
   signature-validation-only session key (24h client-side expiry, automatic
   owner-key fallback).

The session key can **only** answer `isValidSignature` — it can never move funds.
Full lifecycle: `docs/UPDOWN_LIFECYCLE.md` in the updown-backend repo. Custody
code lives in `src/lib/accountKit.ts` (a vendored copy of the SDK's signer).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (`next dev --turbopack`) on :3000 |
| `npm run build` | Production build. A `prebuild` hook runs `scripts/check-stake-bounds-parity.mjs` and **fails the build** if the $5–$500 stake-bound constants drift from the backend/SDK. |
| `npm start` | Serve the production build |
| `npm test` | Unit tests (`vitest run`) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run lint` | ESLint |

---

## Where things live

| Concern | Path |
|---|---|
| Custody / signing (Account Kit) | `src/lib/accountKit.ts` |
| Wallet connect + SCA derivation | `src/context/WalletContext.tsx` |
| EIP-712 order/cancel builders | `src/lib/eip712.ts` |
| WS-auth signing | `src/lib/wsAuth.ts` |
| Trade form (onboard + sign + post) | `src/components/TradeForm.tsx` |
| REST client | `src/lib/api.ts` |
| WebSocket hook | `src/hooks/useUpDownWebSocket.ts` |
| Backend error-string mapping | `src/lib/errors.ts` |
| Runtime config (chain, addresses, symbols) | `src/config/environment.ts`, `src/config/wagmi.ts` |
| Geo gate | `src/lib/geo.ts`, `src/middleware.ts` |
