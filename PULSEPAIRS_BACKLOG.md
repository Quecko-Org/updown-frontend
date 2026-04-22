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
