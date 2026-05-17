# UpDown HTTP + WebSocket API Reference

> **Audience:** integrators (DMM bots, custody, analytics, frontend clients).
> **Status:** Phase 4 architecture — per-user ThinWallet smart accounts, ERC-1271 signature recovery, relayer-broadcast meta-tx execution. Anything older than 2026-05-13 in archived docs refers to a superseded model and does not apply.

> **Placeholders.** `{{LIKE_THIS}}` strings in code blocks are filled in by `scripts/inject-config-into-docs.mjs` at content-build, sourced from `GET /config` against the target deployment. Read [§Placeholder injection](#placeholder-injection) for the source-of-truth pattern.

---

## Quick start

1. **Connect** a wallet (MetaMask / Coinbase / WalletConnect) to a UI that targets PulsePairs, or build directly against the API with `viem` + a private key. The first connect deploys your **ThinWallet** smart account at a deterministic address derived from your wallet via `CREATE2`. Your wallet is the owner.
2. **Onboarding — two one-time signatures, both gasless:**
   - **Identity sign** (`personal_sign` over your lowercased wallet address) — backend uses this to deploy your ThinWallet via `POST /thin-wallet/provision`.
   - **Approve sign** — EIP-712 `ExecuteWithSig` envelope authorizing the settlement contract to pull `{{USDT_SYMBOL}}` from your ThinWallet. Broadcast via `POST /thin-wallet/execute-with-sig`.
3. **Fund** your ThinWallet by sending `{{USDT_SYMBOL}}` to its address (returned from `/thin-wallet/provision`). On testnet, mint via `POST /test/devmint` (env-gated, see §Test fixtures). On mainnet, send from any source — CEX withdrawal, another wallet, a bridge.
4. **Trade** by signing an EIP-712 `Order` envelope and `POST /orders`. Your ThinWallet is the `order.maker`; signatures are recovered via ERC-1271 (`isValidSignature`). The matching engine pairs you with a counterparty, the relayer broadcasts the on-chain `enterPosition`. Every trade after onboarding is one signature — zero gas, zero extra approvals.
5. **Subscribe** to `/stream` for real-time fills, order updates, balance changes, and orderbook snapshots. Authenticate the socket via the `WsAuth` typed-data handshake for per-wallet channels (`orders:*`, `balance:*`).
6. **Withdraw** by signing a second `ExecuteWithSig` envelope that calls `{{USDT_SYMBOL}}.transfer(destination, amount)` on your ThinWallet. Relayer broadcasts; destination receives `{{USDT_SYMBOL}}`.

Base URL on dev: `https://dev-api.pulsepairs.com` ({{CHAIN_NAME}}, chainId `{{CHAIN_ID}}`). Mainnet base TBD at launch.

---

## Architecture

- **Settlement contract** (`{{SETTLEMENT_ADDRESS}}`) — single multi-pair contract that verifies signatures (EOA + ERC-1271), pulls `{{USDT_SYMBOL}}` via `transferFrom` from the maker's ThinWallet, escrows positions, distributes payouts at resolution. The `verifyingContract` field of the EIP-712 `Order` domain. Same address services BTC-USD and ETH-USD.
- **ThinWalletFactory** (`{{THIN_WALLET_FACTORY_ADDRESS}}`) — `CREATE2` factory that deploys per-user `ThinWallet` smart accounts at deterministic addresses derived from the owner EOA. Idempotent — re-calling `deployWallet(eoa)` returns the existing address.
- **AutoCycler** (`{{AUTOCYCLER_ADDRESS}}`) — owner-managed registry that creates new markets at clock-aligned boundaries (5m / 15m / 1h) for every registered pair. Triggered by Chainlink Automation in production, by a cron stopgap on dev when Automation isn't wired.
- **Resolver** (`{{RESOLVER_ADDRESS}}`) — wraps Chainlink price feeds + Chainlink Data Streams reports for BTC/USD + ETH/USD. Snapshots the open price at market start, the close price at end. Drives win/loss.
- **Matching engine** — off-chain CLOB. Orders match on (price, time) priority. Settlement is on-chain per fill via the relayer hot wallet.
- **Relayer** (`{{RELAYER_ADDRESS}}`) — backend-controlled EOA that pays {{NATIVE_SYMBOL}} gas for every on-chain action: ThinWallet deployment, ERC-20 approve via executeWithSig, settlement fills, claim distribution, withdraw transfers. The relayer is `onlyRelayer`-gated at the Settlement contract — third parties can't replay leaked signatures.

---

## Auth model

Three levels of authorization across the API surface. Endpoints declare their required level inline.

### L0 — public (no auth)

Read-only endpoints with no PII or wallet-scoped data: `GET /config`, `GET /version`, `GET /health`, `GET /markets`, `GET /markets/:address`, `GET /orderbook/:marketAddress`, `GET /stats`, `GET /prices/history/:symbol`, and the public WebSocket channels (`markets`, `orderbook:*`, `trades:*`).

### L1 — embedded signature (per-request)

Per-request EIP-712 signature embedded in the request body. The request *is* the auth — no header credentials. Used for:

- `POST /thin-wallet/provision` (verify-wallet `personal_sign` over the lowercased EOA)
- `POST /thin-wallet/execute-with-sig` (EIP-712 `ExecuteWithSig` envelope against the ThinWallet's domain)
- `POST /orders` (EIP-712 `Order` against the Settlement domain — recovered via ERC-1271 dispatch when the maker is a contract)
- `DELETE /orders/:orderId` (EIP-712 `Cancel` envelope, same domain as the original order)
- WebSocket per-wallet channel subscriptions (EIP-712 `WsAuth` handshake)

L1 routes are not header-authenticated and accept the request from any IP — replay protection is the signature's `nonce` + `expiry` + (where applicable) the backend's 5-min replay cache.

### L2 — HMAC API key

Long-lived API-key-style credentials for high-throughput integrators (DMM bots, analytics dashboards, automation pipelines) where signing every request would add latency. Phase 3 Gate 1 (post-audit) shipped this layer.

```
x-pulsepairs-api-key:   <16-byte hex key id>
x-pulsepairs-signature: <32-byte hex HMAC-SHA256(secret, request payload)>
x-pulsepairs-timestamp: <unix-sec, within ±60s of server clock>
```

Where the signing payload is:

```
<method>\n<path>\n<timestamp>\n<sha256(body)>
```

**Credential issuance.** A wallet signs an EIP-712 `ClobAuth` envelope and posts to `POST /auth/credentials` to mint a key. Credentials have a 30-day TTL by default (`HMAC_CREDENTIAL_TTL_SEC` override). The mint flow is itself L1 — the EIP-712 sig proves wallet ownership.

```ts
const clobAuthDomain = {
  name: "PulsePairsAuthDomain",
  version: "1",
  chainId: {{CHAIN_ID}},
};

const types = {
  ClobAuth: [
    { name: "address",   type: "address" },
    { name: "timestamp", type: "string"  },
    { name: "nonce",     type: "uint256" },
    { name: "message",   type: "string"  },
  ],
};

const message = {
  address: wallet,                                  // EOA owner
  timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: 1n,                                        // per-wallet monotonic
  message: "This message attests that I control the given wallet",
};
```

Routes accepting L2 dispatch on `req.auth.kind === 'hmac'` and bind to the address resolved from the API key. Routes that accept either L1 or L2 fall through to L1 verification when no HMAC headers are present.

---

## ThinWallet — smart account auth

### What it is

A per-user `ThinWallet` contract owned by the user's EOA. Deployed at a deterministic address via `ThinWalletFactory.deployWallet(eoa)` (`CREATE2`, idempotent). Exposes:

- `owner() view returns (address)` — the EOA that authorizes moves.
- `isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)` — ERC-1271 ([EIP-1271](https://eips.ethereum.org/EIPS/eip-1271)) dispatcher. Recovers the signer from `signature` against the ThinWallet's own EIP-712 domain (name=`PulsePairsThinWallet`, version=`1`, chainId=current, verifyingContract=`<this wallet>`) using the `WalletAuth(bytes32 hash)` typed-data wrap, and checks recovered === owner.
- `executeWithSig(address target, bytes data, uint256 nonce, uint256 deadline, bytes signature) returns (bytes)` — meta-tx executor. EIP-712 signature over `ExecuteWithSig(address target, bytes data, uint256 nonce, uint256 deadline)` against the wallet's domain. Replay-safe via random uint256 `nonce` (per-wallet `usedNonces` map) + `deadline`. Only the contract's relayer can call.

### Provisioning — POST /thin-wallet/provision

L1 auth. Body:

```json
{
  "eoa": "0xabc...",
  "signature": "0x..."   // personal_sign over the lowercased EOA address
}
```

The relayer fires `factory.deployWallet(eoa)` if the wallet doesn't exist yet. Idempotent — re-calling returns the existing TW address.

Returns:

```json
{
  "twAddress": "0xdef...",
  "deployed": true,
  "txHash": "0xabc...",
  "deployedAtBlock": 268500000
}
```

Status codes: `200` (success / already deployed), `400` (bad signature / invalid EOA), `503` (factory not configured on this chain).

Not rate-limited — idempotency + CREATE2 collision protection + in-process per-EOA lock are the protection. Prior 1-per-EOA-per-5min limit broke legitimate refresh patterns for returning users (the user opens a fresh tab, the hook tries to provision again, gets blocked → flagged as a bug, removed in PR-A).

### Meta-tx broadcast — POST /thin-wallet/execute-with-sig

L1 auth. Body:

```json
{
  "eoa": "0xabc...",
  "signedAuth": {
    "target":    "0x...",        // contract to call (USDTM, Settlement, etc.)
    "data":      "0x...",        // ABI-encoded calldata
    "nonce":     "<uint256 str>",
    "deadline":  <unix-sec>,
    "signature": "0x..."
  }
}
```

The relayer:
1. Resolves the TW address from `eoa` (predicted via factory, no on-chain call).
2. Calls `TW.executeWithSig(target, data, nonce, deadline, signature)` from its hot wallet.
3. Inside the contract: verify signature, mark nonce used, `target.call(data)` (bubbles inner revert), emit `Executed(target, nonce, data)`.

Returns:

```json
{ "txHash": "0xabc...", "blockNumber": 268500001, "twAddress": "0xdef..." }
```

Idempotent within a 5-min cache window keyed by `(eoa, signature)` — re-POSTing the same envelope returns the cached `txHash`. Rate-limited at 10 requests per EOA per minute (the `executeWithSig` route only — `/provision` is not limited).

Status codes: `200` (success / cache hit), `400` (bad signature / zero target / unparseable nonce), `409` (`nonce` already used), `410` (`deadline` past), `502` (`target.call` reverted on-chain — error from the inner contract propagates), `503` (factory not deployed).

### Signing flows

Two distinct envelope shapes — DO NOT mix domains.

**ExecuteWithSig** (meta-tx broadcast, used for approve, transfer, withdraw, etc.):

```ts
const twDomain = {
  name: "PulsePairsThinWallet",
  version: "1",
  chainId: {{CHAIN_ID}},
  verifyingContract: twAddress,   // the user's TW
};

const execTypes = {
  ExecuteWithSig: [
    { name: "target",   type: "address" },
    { name: "data",     type: "bytes"   },
    { name: "nonce",    type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
```

**WalletAuth** (wrap an outer typed-data digest for ERC-1271 dispatch, used for Order / Cancel signatures when the maker is a contract):

```ts
const walletAuthTypes = {
  WalletAuth: [{ name: "hash", type: "bytes32" }],
};
// outerDigest = hashTypedData(orderDomain, ORDER_TYPES, "Order", orderMessage)
const message = { hash: outerDigest };
// Signed against TW's domain (not the order's Settlement domain).
```

The on-chain `isValidSignature(outerDigest, signature)` re-derives the TW's domain digest of `WalletAuth(hash=outerDigest)`, recovers the signer from `signature`, returns `0x1626ba7e` (the EIP-1271 magic value) iff `recovered == owner`. `viem`'s `verifyTypedData` does the right thing transparently when the maker is a contract — no caller branching required.

EIP-712 domain binding via `verifyingContract = twAddress` ensures a signature valid for wallet A cannot replay against wallet B (the [Alchemy LightAccount](https://github.com/alchemyplatform/light-account) guardrail).

---

## Chainlink Data Streams

Streams ([Chainlink Data Streams](https://docs.chain.link/data-streams)) is the production price-feed source for resolution. The dev cycle ran through three gates:

- **Gate 1 — testnet wiring.** Resolver consumes Streams reports for BTC/USD + ETH/USD on Arbitrum Sepolia. Reports include an off-chain timestamp + a Verifier proof; the Resolver verifies the proof on-chain via the `Verifier` contract from Chainlink before accepting the price.
- **Gate 2 — fallback ladder.** When a Streams report is unavailable (verifier rate-limit, off-chain feed downtime), the Resolver falls back to Chainlink's standard AggregatorV3 feed at the same pair. Both code paths are deployed; the switch is in `Resolver._priceAt(...)`.
- **Gate 3 — stale-data guards.** Reports older than the configured `MAX_PRICE_AGE_SEC` are rejected with `StalePrice` (revert custom error). Resolution waits one upkeep tick before retrying.

The Settlement contract does not consume Streams directly. The Resolver fetches the report, verifies it, sets the strike/settlement prices on the Settlement contract. Frontend integrations don't need to know about Streams — `GET /markets/:address` returns the resolved prices as plain numbers, regardless of source feed.

---

## REST endpoints

### `GET /version` — L0

```json
{
  "commit": "{{COMMIT}}",
  "bootedAt": "{{BOOTED_AT}}",
  "env": "{{ENV}}",
  "nodeVersion": "v22.22.2"
}
```

Not rate limited. Cheap probe for "did the deploy land?"

### `GET /health` — L0

```json
{ "status": "ok", "relayer": "{{RELAYER_ADDRESS}}", "uptime": 16199.98 }
```

Not rate limited. Use for status indicators.

### `GET /config` — L0

Public chain + EIP-712 + fee config. The authoritative runtime answer for every address, fee param, and pair entry. **Read this at startup; do not hardcode addresses.**

```json
{
  "chainId": {{CHAIN_ID}},
  "usdtAddress": "{{USDT_ADDRESS}}",
  "relayerAddress": "{{RELAYER_ADDRESS}}",
  "platformFeeBps": 70,
  "makerFeeBps": 80,
  "feeModel": "probability-weighted",
  "peakFeeBps": 150,
  "dmmRebateBps": 30,
  "usdtDecimals": 6,
  "thinWalletFactoryAddress": "{{THIN_WALLET_FACTORY_ADDRESS}}",
  "pairs": [
    {
      "pairId": "BTC-USD",
      "settlementAddress": "{{SETTLEMENT_ADDRESS}}",
      "autocyclerAddress": "{{AUTOCYCLER_ADDRESS}}",
      "eip712": {
        "domain": {
          "name": "UpDown Exchange",
          "version": "1",
          "chainId": {{CHAIN_ID}},
          "verifyingContract": "{{SETTLEMENT_ADDRESS}}"
        }
      }
    }
  ],
  "settlementAddress": "{{SETTLEMENT_ADDRESS}}",
  "eip712": { "domain": { "...": "..." } }
}
```

**Deprecation:** the top-level `settlementAddress` and `eip712.domain` fields hold the **first pair's** values for backward-compat with single-pair clients. They will be removed one release cycle after every active client reads from `pairs[]`. Migrate now.

**Live addresses are authoritative** — pull from `GET /config` at runtime, do not hardcode. Contract bundles can redeploy; SDK examples (`sdk/typescript/examples/*.ts`) all read from `/config` at startup — the recommended pattern.

### `GET /markets` — L0

Optional query: `timeframe=300|900|3600`, `pair=BTC-USD|ETH-USD`, `status=ACTIVE`.

```json
[
  {
    "address": "{{SETTLEMENT_ADDRESS}}-420",
    "marketId": "420",
    "settlementAddress": "{{SETTLEMENT_ADDRESS}}",
    "pairId": "ETH-USD",
    "pairSymbol": "ETH-USD",
    "chartSymbol": "ETH",
    "startTime": 1777458600,
    "endTime": 1777458900,
    "duration": 300,
    "status": "ACTIVE",
    "winner": null,
    "upPrice": "...",
    "downPrice": "...",
    "strikePrice": "234485117000",
    "settlementPrice": "0",
    "volume": "0"
  }
]
```

`status` ∈ `ACTIVE | TRADING_ENDED | RESOLVED | CLAIMED`. `address` is the composite `<settlement>-<marketId>` used everywhere as the canonical market key.

### `GET /markets/:address` — L0

Detail. Same fields as `/markets` plus:

```json
{
  "timeRemainingSeconds": 203,
  "orderBook": {
    "up":   { "bestBid": { "price": 4500, "depth": "..." }, "bestAsk": { "price": 5500, "depth": "..." } },
    "down": { "bestBid": { "...": "..." }, "bestAsk": { "...": "..." } }
  }
}
```

### `GET /orderbook/:marketAddress` — L0

Full book per side. Prices are in **basis points** (1¢ = 100 bps; 50¢ = 5000 bps).

```json
{
  "up":   { "bids": [{ "price": 4500, "depth": "...", "count": 3 }], "asks": [] },
  "down": { "bids": [], "asks": [] }
}
```

### `GET /balance/:wallet` — L0

```json
{
  "wallet": "0xabc...",
  "smartAccountAddress": "0xdef...",
  "available": "65000000",
  "inOrders": "0",
  "cachedBalance": "65000000",
  "balanceLastSyncedAt": "2026-05-16T10:38:20.546Z",
  "withdrawNonce": 0
}
```

The `wallet` path param accepts either the EOA owner OR the ThinWallet address — the backend resolves to the ThinWallet's `{{USDT_SYMBOL}}` balance either way. `cachedBalance` mirrors the on-chain `{{USDT_SYMBOL}}` balance of the ThinWallet contract; `available = cachedBalance − inOrders`. Frontends derive `inOrders` from the open-orders list, not this field — backend's `inOrders` has a known slow-leak (filed) and may drift higher than the actual locked sum.

### `GET /positions/:wallet` — L0

```json
[
  {
    "market": "{{SETTLEMENT_ADDRESS}}-420",
    "marketStatus": "ACTIVE",
    "option": 1,
    "optionLabel": "UP",
    "shares": "5000000",
    "avgPrice": 5500,
    "costBasis": "2750000"
  }
]
```

`shares` is the notional (atomic `{{USDT_SYMBOL}}`). `avgPrice` in bps. `costBasis = shares × avgPrice / 10000`. Positions are keyed by the ThinWallet address — the `wallet` path param accepts EOA or TW.

### `GET /trades/:wallet` — L0

Per-wallet trade history. Paginated via `?limit=&offset=`. Wallet param: EOA or TW.

### `GET /orders/:wallet` — L0

Open + recent orders for a wallet (EOA or TW). Filter via `?status=OPEN&status=PARTIALLY_FILLED&limit=50`.

```json
{
  "orders": [
    {
      "orderId": "e121947b-...",
      "maker": "0xdef...",
      "market": "{{SETTLEMENT_ADDRESS}}-420",
      "option": 1,
      "side": 0,
      "type": 1,
      "price": 0,
      "amount": "5000000",
      "filledAmount": "5000000",
      "nonce": "101506360828",
      "expiry": "1777458900",
      "status": "FILLED",
      "createdAt": "2026-05-16T10:31:37.401Z"
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0
}
```

`order.maker` is the ThinWallet address (the user's smart account), not the EOA. The backend records orders by TW; querying by EOA resolves the corresponding TW first then returns its orders.

`nonce` and `expiry` are returned as **JSON strings** (not numbers) to preserve full uint256 precision the contract verifies against. Number-typed consumers silently truncate above `2^53`. Parse via `BigInt(orders[i].nonce)` if you need numeric arithmetic; pass the string straight through to `signTypedData` if you're round-tripping (viem accepts string-form bigints in typed-data messages).

### `POST /orders` — L1 or L2

Place an order. Body **and** (for L1) an EIP-712 signature.

```json
{
  "maker": "0xdef...",           // ThinWallet address (not EOA)
  "market": "{{SETTLEMENT_ADDRESS}}-420",
  "option": 1,
  "side": 0,
  "type": 1,
  "price": 0,
  "amount": "5000000",
  "nonce": "101506360828",
  "expiry": 1777458900,
  "signature": "0x..."           // L1: WalletAuth-wrapped EIP-712, L2 omits
}
```

Field semantics:

| Field | Type | Meaning |
|---|---|---|
| `maker` | `address` | The user's **ThinWallet** address. `order.maker` is the on-chain identity in settlement and the address that accumulates positions + rebates. |
| `option` | `1 \| 2` | 1 = UP, 2 = DOWN |
| `side` | `0 \| 1` | 0 = BUY, 1 = SELL |
| `type` | `0 \| 1 \| 2 \| 3` | LIMIT \| MARKET \| POST_ONLY \| IOC |
| `price` | bps | 1–9999 for LIMIT/POST_ONLY/IOC; **0** for MARKET |
| `amount` | atomic {{USDT_SYMBOL}} | 1 {{USDT_SYMBOL}} = 1_000_000 |
| `nonce` | uint256 | Any unique number per order |
| `expiry` | unix sec | Backend rejects past expiry |

Returns `201 { id, status, market, option, side, type, price, amount, createdAt }`. Errors return `4xx { error: "..." }`.

#### EIP-712 typed data

Sign with the **domain matching the market's settlement** (`pairs[i].eip712.domain` where `pairs[i].settlementAddress === parseComposite(market).settlementAddress`). For ThinWallet makers (the common case under Phase 4), wrap the order digest in a `WalletAuth` envelope against the TW's domain — see [§ThinWallet signing flows](#signing-flows).

```ts
const domain = {
  name: "UpDown Exchange",
  version: "1",
  chainId: {{CHAIN_ID}},
  verifyingContract: "{{SETTLEMENT_ADDRESS}}",
};

const types = {
  Order: [
    { name: "maker",  type: "address" },
    { name: "market", type: "uint256" }, // numeric marketId from settlement contract
    { name: "option", type: "uint256" },
    { name: "side",   type: "uint8"   },
    { name: "type",   type: "uint8"   },
    { name: "price",  type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "nonce",  type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};
const primaryType = "Order";
```

The message field `market` is the **uint256 marketId** (the suffix after the `-` in the composite key), not the composite string. The composite goes in the request body's `market` field for routing; the signed message's `market` is the bare number.

Signature recovery: backend calls `viem.verifyTypedData(domain, types, "Order", orderMessage, signature, order.maker)`. When `order.maker` is a contract (the Phase 4 default), viem auto-dispatches to ERC-1271 via `SignatureChecker.isValidSignatureNow` — no caller branching.

#### Order types

| `type` | Name | Behavior |
|---|---|---|
| `0` | LIMIT | Rests on book at `price` if no immediate match, else partials fill against the book |
| `1` | MARKET | Hits the book at the prevailing best-ask (BUY) / best-bid (SELL); price field must be `0` |
| `2` | POST_ONLY | Rejected if it would cross the book (`400 "POST_ONLY order would match immediately"`); else rests |
| `3` | IOC | Fill-or-cancel: matches what's available at `price` or better, cancels the remainder |

#### Stake bounds

Orders must satisfy `$5 ≤ stake ≤ $500` {{USDT_SYMBOL}} (= `5_000_000 ≤ amount ≤ 500_000_000` atomic). Backend enforces both bounds at the API boundary via `lib/stakeBounds.ts:checkStakeBounds(...)` before signature verification — out-of-range submissions return `400` with a stake-bound error string. Frontend mirrors the same bounds for UX. Defense-in-depth: validate client-side too, so a bad value never produces a signed payload at all.

### `DELETE /orders/:orderId` — L1 or L2

Cancel an order. L1 body: `{ "maker": "0xdef...", "signature": "0x...", "nonce": "<uint256>", "expiry": <unixSec> }` where the signature is EIP-712 over a `Cancel` message wrapped in `WalletAuth` (for ThinWallet makers). PR-13 (P1-4) added `nonce` + `expiry` to the signed payload so a captured cancel sig can't be replayed forever; mirrors Polymarket's clob-client cancel typed-data shape.

```ts
const types = {
  Cancel: [
    { name: "maker",   type: "address" },
    { name: "orderId", type: "string"  },
    { name: "nonce",   type: "uint256" },
    { name: "expiry",  type: "uint256" },
  ],
};
const primaryType = "Cancel";
const message = { maker, orderId, nonce, expiry };
```

The cancel signature uses the same per-pair domain as the original order. For ThinWallet makers, wrap in `WalletAuth` against the TW's domain — same pattern as Order.

Field semantics:

| Field | Type | Meaning |
|---|---|---|
| `maker` | `address` | The order's `maker` — i.e. the ThinWallet address. |
| `nonce` | uint256 | Unique per cancel — captured by the backend's replay cache for 5 min. **Send as JSON string** to preserve full uint256 precision over the wire. |
| `expiry` | unix sec | Backend rejects past-`expiry` cancels. |

Backend rejects on:
- Past `expiry` → `404 "Order not found"` (info-disclosure-collapsed; see `routes/orders.ts`)
- Replayed `(maker, nonce)` within 5 min → `404 "Order not found"`
- Bad sig / wrong maker / unknown order / already-cancelled / already-filled → all return the same `404 "Order not found"`
- Order found, owner matches, sig valid, but market no longer ACTIVE → `400 "Market is no longer active"` (legitimate maker on closed market — distinct on purpose).

Returns `200 { id, status: "CANCEL_PENDING" }`. The matching engine releases locked collateral and emits an `order_update` with `status="CANCELLED"` once processed.

### `POST /thin-wallet/provision` — L1

See [§ThinWallet provisioning](#provisioning--post-thin-walletprovision).

### `POST /thin-wallet/execute-with-sig` — L1

See [§ThinWallet meta-tx broadcast](#meta-tx-broadcast--post-thin-walletexecute-with-sig).

### `POST /auth/credentials` — L1 (issuance) / L2 (rotation)

Mint or rotate an HMAC API key. L1 issuance — wallet signs `ClobAuth`, body is `{ address, signature, timestamp, nonce, expiresInSec? }`. Returns `{ apiKey, apiSecret, expiresAt }`. Store the secret immediately; it's never returned again. Default TTL 30 days. L2 rotation — caller uses an existing valid key to mint a fresh one before the current expires.

### `POST /markets/:address/claim` — admin only

Relayer / admin only. Headers: `x-updown-admin-key: <CLAIM_ADMIN_API_KEY>` OR body `{ "signature": "<EIP-191 sig from relayer over 'updown:claim:<address>:<chainId>'>" }`. End users do NOT call this — winnings auto-claim.

### `GET /stats` — L0

```json
{ "totalVolume": "640000000", "activeMarketsCount": 6, "totalTraders": 6 }
```

### `GET /prices/history/:symbol` — L0

Proxied chart data. `symbol` ∈ `BTC | ETH`. Returns the upstream feed's price series for the chart panel.

### `GET /admin/*` — admin only

Operational endpoints. `/admin` is gated by `x-updown-admin-key`.

### `POST /test/devmint` — L0, dev-only

**Available only when `NODE_ENV !== 'production'`.** Mints `{{USDT_SYMBOL}}` to any address on the active testnet via the backend relayer. Used by the Phase 4d Playwright ladder to fund freshly-deployed ThinWallets without needing the deployer's private key in CI.

Body:

```json
{ "address": "0xabc...", "amount": "1000000000" }
```

Amount is atomic (e.g. `1_000_000_000` = 1000 {{USDT_SYMBOL}}). Capped at 10,000 {{USDT_SYMBOL}} per call to bound test-runaway risk. Returns `{ txHash, blockNumber }`. Returns `404` if `NODE_ENV === 'production'` — defense-in-depth on top of the mount-time gate in `src/index.ts`.

---

## WebSocket

Connect to `/stream`. Public channels (`markets`, `orderbook:*`, `trades:*`) can be subscribed directly; **per-wallet channels (`orders:<wallet>`, `balance:<wallet>`) require the EIP-712 `WsAuth` handshake** before the subscribe will return events.

### Public-only subscribe (no auth)

```json
{ "type": "subscribe", "channels": ["markets", "orderbook:{{SETTLEMENT_ADDRESS}}-420"] }
```

Server responds `{ "type": "subscribed", "channels": [...] }`. Each channel's events arrive as `{ "type": "<event>", "channel": "<channel>", "data": { "...": "..." } }`.

### Authenticated subscribe (required for `orders:*` and `balance:*`)

PR-19 (P0-18) added a signed handshake that gates per-wallet channels. Without it the server silently never delivers `orders:<wallet>` or `balance:<wallet>` events even after a `subscribed` ack — anonymous clients used to be able to read any wallet's events, which was the bug PR-19 closed.

**Step 1 — sign EIP-712 `WsAuth` typed-data.** Distinct domain from order signing (so an order signature can never be replayed as a WS-auth signature):

```ts
const wsAuthDomain = {
  name: "PulsePairs WebSocket Auth",
  version: "1",
  chainId: {{CHAIN_ID}},
  // Fixed zero address — WsAuth doesn't bind to the settlement contract.
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

const wsAuthTypes = {
  WsAuth: [
    { name: "wallet",    type: "address" },
    { name: "timestamp", type: "uint256" },
    { name: "sessionId", type: "bytes32" },
  ],
};

const message = {
  wallet,                                       // ThinWallet OR EOA (handshake accepts both)
  timestamp: BigInt(Math.floor(Date.now()/1000)),
  sessionId: "0x" + crypto.randomBytes(32).toString("hex"), // fresh per handshake
};
const signature = await walletClient.signTypedData({
  account: wallet, domain: wsAuthDomain, types: wsAuthTypes,
  primaryType: "WsAuth", message,
});
```

When `wallet` is a ThinWallet, wrap in `WalletAuth` against the TW's domain — same pattern as Order/Cancel. Backend's `verifyTypedData` dispatches to ERC-1271.

**Step 2 — send `auth` over the open socket.**

```json
{
  "type": "auth",
  "wallet": "0x...",
  "timestamp": "1777888888",
  "sessionId": "0xfeed...beef",
  "signature": "0x..."
}
```

Server validates: `timestamp` within ±60s of server clock, `(wallet, sessionId)` not already-seen within the timestamp window (replay protection), signature recovers to `wallet` (EOAs and ERC-1271 contract accounts both via `viem.verifyTypedData`).

**Step 3 — receive `auth_ok` (or `auth_error`).**

```json
{ "type": "auth_ok", "wallet": "0x...", "token": "<32-byte hex>", "expiresAt": 1777975288 }
```

Token is a server-issued opaque session token, valid 24h, **server-memory only** (no persistence across pm2 reload — re-auth is one signature). Cache the token in JS memory only (NOT localStorage — closed tab forces re-auth, which is correct for a session token).

```json
{ "type": "auth_error" }
```

**No `reason` field — deliberate.** The server emits a bare `auth_error` so a probe can't distinguish "bad signature" from "timestamp drift" from "sessionId reused" via timing or response shape. Common real causes (debug client-side): `timestamp outside ±60s window` (clock skew), `sessionId reused` (use a fresh 32-byte random per handshake), `invalid signature` (wrong domain — must be `PulsePairs WebSocket Auth`, not the order-signing domain).

**Step 4 — subscribe to per-wallet channels.**

```json
{ "type": "subscribe", "channels": ["orders:0x...", "balance:0x..."] }
```

The server-side wallet binding comes from the validated handshake — there is no `wallet` field on the subscribe payload itself. **Disallowed channels are silently dropped** (e.g. `orders:<other-wallet>` over your authed socket): the `subscribed` reply lists only channels that were actually accepted, so a legitimate client can debug missing subs by diff-ing requested vs accepted, while a probe gets no oracle. There's no `subscribe_error` for forbidden channels.

**Reconnect: replay the cached token.**

```json
{ "type": "auth", "token": "<cached-token>" }
```

Server replies `auth_ok` if the token is still within its 24h TTL, `auth_error` otherwise (in which case start the full sign-handshake over). The TypeScript SDK's `UpDownWsClient.connectAuthed({ signAuth, channels })` does this automatically: caches the token in-memory, replays it on reconnect, only re-prompts the user to sign if the cached token is rejected.

### Channels

| Channel | Auth | Event types | Payload shape |
|---|---|---|---|
| `markets` | public | `market_created`, `market_resolved` | `{ address, marketId, pairId, pairSymbol?, endTime, duration, strikePrice, settlementPrice, winner? }` |
| `orderbook:<marketAddress>` | public | `orderbook_update` | `{ option, snapshot: { bids, asks } }` after each book change for one outcome |
| `trades:<marketAddress>` | public | `trade` | `{ id, market, option, buyer, seller, price, amount, timestamp }` |
| `orders:<wallet>` | **authed** | `order_update` | `{ id, maker, market, option, side, orderType, price, createdAt, status, amount, filledAmount, reason? }` — fires on placement, fill, cancel |
| `balance:<wallet>` | **authed** | `balance_update` | `{ available, inOrders, cachedBalance }` after settlement ticks |

`reason` (when present on `order_update`) ∈ `NO_LIQUIDITY | MARKET_ENDED | EXPIRED | USER_CANCEL | KILL_SWITCH | SESSION_EXPIRED`.

**Known WS↔REST field-name divergence:** the `order_update` payload uses `orderType` (uint8) for the order type field, but `GET /orders/:wallet` and the SDK's `OrderRow` type use `type`. Same value either way (`0`=LIMIT, `1`=MARKET, `2`=POST_ONLY, `3`=IOC); just different field name on different surfaces. Pinned by tests in `src/ws/WebSocketServer.reason.test.ts`. Live with it; renaming would break in-flight clients on either side.

### Heartbeat

Server pings every 25s. If your client doesn't respond to pings within ~60s the socket drops; reconnect and re-subscribe (replaying the cached auth token if you have one).

### Unsubscribe

```json
{ "type": "unsubscribe", "channels": ["orderbook:0x...", "..."] }
```

---

## Settlement flow (per fill)

Atomic on-chain settlement. Every fill produces a single `enterPosition` tx that pulls the buyer's {{USDT_SYMBOL}} from their ThinWallet and pays seller / treasury / maker in one atomic step — no parallel off-chain ledger.

1. Maker (ThinWallet) signs `Order` (wrapped in `WalletAuth` against the TW's domain), client POSTs.
2. Backend verifies signature via `viem.verifyTypedData` — dispatches to ERC-1271 since `order.maker` is a contract.
3. Order enters the matching engine. If filled, the engine writes a `Trade` row recording `sellerReceives = (price × fillAmount) / 10000` (clean price-based proceeds; fees taken from the buyer's residual) and `makerFeeRecipient = order.maker` (the resting-side maker's TW, regardless of side).
4. `SettlementService` picks up the trade and calls `settlement.enterPosition(FillInputs)` from the relayer EOA. The struct carries `{ order, signature, marketId, option, fillAmount, taker, sellerReceives, platformFee, makerFee, makerFeeRecipient }`. The contract is `onlyRelayer` — no third-party fills with leaked signatures.
5. Inside `enterPosition` (atomic):
   - `{{USDT_SYMBOL}}.transferFrom(buyerTW, settlement, fillAmount)`
   - `{{USDT_SYMBOL}}.transfer(sellerTW, sellerReceives)` (skipped if `seller == address(0)` — initial issuance)
   - `{{USDT_SYMBOL}}.transfer(treasury, platformFee)`
   - `{{USDT_SYMBOL}}.transfer(makerFeeRecipient, makerFee)` — paid to **every** maker's TW, not just registered DMMs
   - Contract retains `residual = fillAmount − sellerReceives − platformFee − makerFee = (1 − price/10000) × fillAmount − fees`. Residual is the buyer's at-risk capital backing winning `Position.netShares × $1` at resolution.
6. Maker's order is marked `FILLED` (or `PARTIALLY_FILLED`). `Trade.settlementStatus` flips `PENDING → SUBMITTED → CONFIRMED`. WS pushes `order_update`.

**Failure path.** If `enterPosition` reverts (insufficient allowance / balance / market-ended race), the trade is marked `FAILED` after `MAX_SETTLEMENT_RETRIES`. Atomic settlement means no on-chain transfer happened, so there's nothing to claw back — only the buyer's submit-time `inOrders` lock is restored via `restoreSmartAccountInOrders(buyerTW, fillAmount)`.

**SELL-side collateral.** SELL orders commit shares (`reserveSharesForSell`), not {{USDT_SYMBOL}}. The engine's `lockSmartAccountInOrders` is gated by `if (sideEnum === OrderSide.BUY)`.

---

## Resolution flow (per market)

1. Market `endTime` passes — `MarketSyncer` flips status `ACTIVE → TRADING_ENDED`.
2. AutoCycler's next upkeep tick (Chainlink Automation in prod, cron stopgap on dev) calls `resolver.resolve(marketId)`.
3. `Resolver` reads the Chainlink Data Streams report (with Gate-2 fallback to AggregatorV3) at the market's end timestamp, compares to the strike snapshotted at market start, sets the winner on the settlement contract. Status flips to `RESOLVED`.
4. `ClaimService` calls `settlement.withdrawSettlement(marketId)` to drain the contract's accumulated residuals to the relayer EOA. The contract sets `m.settled = true`.
5. `ClaimService.distributeWinnings` reads winning-side `Position.netShares` (= `sharesBought − sharesSold`) per holder (ThinWallet address) via `getNetSharesByHolder(market, winningOption)`. Each winner gets a `{{USDT_SYMBOL}}.transfer(twAddress, netShares)` from the relayer (1 share = $1 {{USDT_SYMBOL}} atomic — binary winner-takes-all). `ClaimPayoutLog` rows persist the per-(market, wallet) two-phase commit.
6. Losing-side positions receive nothing — `getNetSharesByHolder` filters them out.
7. Rounding leftover (`dust`) is forwarded on-chain to the treasury EOA. Status flips to `CLAIMED`.

If the auto-claim path stalls (RPC rate-limit, gas spike), Portfolio surfaces a manual `Claim` button that nudges the relayer to retry. Funds never strand on-chain — they wait on the contract until claimed.

**Source of truth.** At-resolution payouts are funded by the contract's per-fill residual pool (drained in step 4) and sized by `Position.netShares × $1` (the binary CTF model).

---

## Fees

Probability-weighted: a 50¢ trade pays the peak rate, extremes taper to nearly zero.

```
weight       = 4 × p × (1 − p),  with p = price / 10000   (price in bps)
totalFeeBps  = platformFeeBps + makerFeeBps               (default 70 + 80 = 150)
effectiveBps = totalFeeBps × weight
feeUsd       = notionalUsd × effectiveBps / 10000
```

At 50¢: `weight = 1`, fee = 1.5%. At 90¢: `weight ≈ 0.36`, fee ≈ 0.54%. Read `/config` for live values (`platformFeeBps`, `makerFeeBps`, `peakFeeBps`).

**Fee incidence.** Fees come from the buyer's residual portion (`(1 − price/10000) × fillAmount`), NOT from the seller's proceeds. The seller's TW receives the clean price-based amount `(price × fillAmount) / 10000`. The contract validates `sellerReceives + platformFee + makerFee ≤ fillAmount` before transferring.

**Maker rebate (universal).** Every maker — registered DMM or not — receives `makerFee` atomically as part of `enterPosition`, paid to the maker's ThinWallet. This is the base maker reward, not a special tier.

**DMM bonus rebate.** Registered Designated Market Makers earn an *additional* `dmmRebateBps` (default `30` bps = 0.3%) on top of the universal maker fee. The bonus accrues per-pair on the settlement contract and is claimed via the relayer. DMM status is granted off-chain by the platform (vs. a permissioned `addDMM` whitelist call, which was removed) — there is no public registration endpoint.

---

## Rate limits

- **Global REST** (excluding `/health`): ~400 req/min/IP
- **Order writes** (`POST /orders`, `DELETE /orders/:id`): ~90 req/min/IP
- **ThinWallet execute** (`POST /thin-wallet/execute-with-sig`): 10 req/EOA/min
- **ThinWallet provision** (`POST /thin-wallet/provision`): not limited (idempotent)

`429 Too Many Requests` with JSON `{ "error": "..." }`. Back off exponentially.

A per-wallet REST rate limit is on the Phase 6b backlog.

---

## Errors

All errors are `4xx` or `5xx` JSON: `{ "error": "<short message>" }`. Frontend maps a curated set of these to user-facing strings via `formatUserFacingError` — see `updown-frontend/src/lib/errors.ts` for the canonical mapping. Notable strings (do **not** rename without a migration):

- `Insufficient balance` → "Insufficient {{USDT_SYMBOL}} balance."
- `Market not active` → "This market has ended. Open the live market and try again."
- `Invalid signature` → "Wallet signature couldn't be verified. Please try again."
- `POST_ONLY order would match immediately` → "Post-only would have filled immediately. Try a price further from the book."

---

## Multi-pair routing checklist

When adding a third pair (or running a second instance against a different settlement), audit every callsite that uses `pairs[0]` as a stand-in for "the only pair":

- Frontend: `/config`'s legacy top-level `settlementAddress` is the FIRST pair — multi-pair clients must read `pairs[]`.
- Backend: every per-market operation (signature verify, settlement, claim, fee withdraw, DMM rebate) routes by the market's `settlementAddress`, looked up via `findPairBySettlement(...)`. Order-flow tests in `src/services/*.test.ts` cover the boundary.

---

## Placeholder injection

This doc uses `{{PLACEHOLDER}}` strings for every chain-bound value (addresses, chain ID, native symbol, token symbol). The strings are not literally what gets served — `scripts/inject-config-into-docs.mjs` reads `GET /config` against the target deployment at content-build time, substitutes every placeholder with the live value, and writes the result to `docs/api.generated.md`. The published docs site serves the generated file.

**Placeholder ↔ source mapping:**

| Placeholder | Source | Example (testnet) | Example (mainnet) |
|---|---|---|---|
| `{{CHAIN_ID}}` | `/config.chainId` | `421614` | `42161` |
| `{{CHAIN_NAME}}` | derived from chainId | `Arbitrum Sepolia` | `Arbitrum One` |
| `{{NATIVE_SYMBOL}}` | derived from chainId | `ETH` | `ETH` |
| `{{USDT_SYMBOL}}` | derived from chainId | `USDTM` | `USDT` |
| `{{USDT_ADDRESS}}` | `/config.usdtAddress` | `0xC6322AF66F88f2Fd64F4484566Fdf7Dd21247502` | (mainnet USDT) |
| `{{SETTLEMENT_ADDRESS}}` | `/config.pairs[0].settlementAddress` | `0x25496611A0A4B990CaD331aE31775A07521EE95C` | (mainnet) |
| `{{AUTOCYCLER_ADDRESS}}` | `/config.pairs[0].autocyclerAddress` | `0x0A0aA3A4E533Ab9e74c6c7ed6a18Be8F815E6E64` | (mainnet) |
| `{{RESOLVER_ADDRESS}}` | (env-bound — separate read) | `0x7bD5d7b6087E42762Af54B5a1780bd8A11380857` | (mainnet) |
| `{{THIN_WALLET_FACTORY_ADDRESS}}` | `/config.thinWalletFactoryAddress` | `0x2dCE78dff34D717883769d1B718AD43AE007b474` | (mainnet) |
| `{{RELAYER_ADDRESS}}` | `/config.relayerAddress` | `0x52E7b54261c147B994Cc1C62F4CD501be82086a0` | (mainnet) |
| `{{COMMIT}}` / `{{BOOTED_AT}}` / `{{ENV}}` | `/version` | from `git rev-parse HEAD` | from CI deploy |

To preview the generated doc locally: `npm run docs:build` (defined in `package.json` — runs `scripts/inject-config-into-docs.mjs` with `PHASE4D_API_BASE` defaulted to dev). The generated file lives in `docs/api.generated.md` and is gitignored — only the placeholder template is checked in.

---

## Versioning

Breaking changes get a single release cycle of overlap. The deprecated top-level `/config` fields will be removed when (a) all internal frontends + SDKs read from `pairs[]` AND (b) at least 30 days have passed since the deprecation note shipped.
