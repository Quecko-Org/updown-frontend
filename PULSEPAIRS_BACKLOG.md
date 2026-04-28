# PulsePairs Frontend — Backlog

Non-blocking issues and deferred work. Items here don't block day-to-day
shipping but should be resolved before a specific milestone (noted per
item). Add new entries with a short title, a "Why it matters" line, a
reproduction or link, and a target milestone.

---

## Dependency hygiene

### wagmi / porto peer-dep conflict — `--legacy-peer-deps` workaround

- **Filed:** 2026-04-22 (Phase 3b Lucide install)
- **Target:** resolve before mainnet launch.
- **Why it matters:** `npm install` fails with an `ERESOLVE` error for any
  new dependency unless `--legacy-peer-deps` is passed. Current
  developers and CI already work around it, but the silent peer-dep
  violation means we're running an untested combination of
  `@wagmi/core`, `wagmi`, and `porto` (transitively pulled through
  `@wagmi/connectors` 5.x via `@account-kit/react`). A breaking change
  in any of those packages could surface first on our wallet flows.
- **Repro:** `rm -rf node_modules && npm install lucide-react` (or any
  new package) — fails without `--legacy-peer-deps`.
- **Root cause (approx):** `@account-kit/react@^4.87` pins
  `@wagmi/connectors@^5.1.15`, which transitively requires
  `porto@0.2.19`, which expects `@wagmi/core >= 2.16.3`. Our root
  `wagmi@^2.19.5` brings in `@wagmi/core@2.22.1` — satisfies the range
  but also pulls in a newer `@wagmi/connectors@6.2.0` that imposes a
  narrower `@wagmi/core` peer constraint, which conflicts with the
  `@account-kit/react`-pinned 5.x tree.
- **Resolution options:**
  1. Bump `@account-kit/react` to a version that uses `@wagmi/connectors@^6` if/when available.
  2. Pin matching `wagmi` / `@wagmi/core` versions as overrides in
     `package.json`'s `overrides` field.
  3. Drop `porto` from the connector list if we don't use it in
     production and hoist the dep tree manually.
- **Known blast radius:** wallet connection (MetaMask, WalletConnect,
  Coinbase), EIP-712 order signing, smart-account creation. Any wagmi
  surface could break silently on a minor version bump until this is
  resolved.

---

## Charting

### Real OHLC candle support

- **Filed:** 2026-04-29 (Phase2-G chart improvements)
- **Target:** P1 post-launch.
- **Why it matters:** Phase2-G shipped a Strike-fit / Spot-fit Y-zoom
  toggle and an implied-probability strip but explicitly skipped a
  line/candle toggle. The price feed exposes only tick data
  (`{ t, p }` from `getPriceHistory`), so candles would have to be
  bucketed client-side from those ticks. Tick-bucketed fake candles
  produce misleading wicks/bodies — the user reads them as real OHLC
  state when they're really just `min/max/first/last` of an arbitrary
  client-side window. We declined to ship that quality.
- **Repro:** N/A — feature gap.
- **Resolution options:**
  1. Backend: add an OHLC bucketing service that stores 1s/5s/30s bars
     per symbol and exposes a new endpoint (`/priceHistory/ohlc?…`).
  2. Integrate a Chainlink/Binance OHLC feed directly and surface that
     to the frontend instead of computing bars ourselves.
- **Known blast radius:** chart presentation only — no settlement /
  trade-flow impact. Safe to defer past launch.
