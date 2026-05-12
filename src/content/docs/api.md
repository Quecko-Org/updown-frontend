<!-- AUTO-COPIED — do not edit, regenerate from updown-backend -->
# UpDown HTTP + WebSocket API Reference

> **Audience:** integrators (DMM bots, custody, analytics, frontends).
> **Status:** reflects the Path-1 EOA-direct architecture deployed on dev (commit `c1eb901a`+). The legacy MA v2 / pooled-deposit model is removed — anything older than 2026-04-27 in archived docs does not apply.

---

## Quick start

1. Hold USDT on Arbitrum One (address: see `usdtAddress` in `GET /config`, your single source of truth for chain wiring) in your **own wallet**. UpDown is non-custodial — there is **no platform deposit**. Funds stay where they are.
2. Once per wallet: call `USDT.approve(settlement, MaxUint256)` from your wallet (or use the SDK helper `ensureSettlementAllowance()` from `sdk/typescript/src/approve.ts`, which is idempotent and only re-approves below a 10k-USDT floor). The settlement contract pulls USDT directly at fill time via `transferFrom`. ETH gas for this single tx is on you (~50k gas, sub-cent on Arbitrum).
3. To trade: sign an EIP-712 typed-data `Order` and `POST /orders`. The matching engine pairs you with a counterparty and the relayer broadcasts the on-chain `enterPosition` call. Subsequent trades are gasless from the maker's perspective.
4. Subscribe to `/stream` for real-time fills, order updates, and orderbook snapshots.

Base URL on dev: `https://dev-api.pulsepairs.com`. Mainnet base TBD at launch.

---

## Architecture (one-line each)

- **Settlement contract** — single multi-pair contract on Arbitrum that verifies signatures, pulls USDT, escrows positions, distributes payouts. The `verifyingContract` field of the EIP-712 domain. Same address services BTC and ETH.
- **AutoCycler** — owner-managed registry that creates new markets at clock-aligned boundaries (5m / 15m / 1h) for every registered pair. Triggered by Chainlink Automation in production, by a stopgap cron on dev until then.
- **Resolver** — wraps Chainlink price feeds (BTC/USD + ETH/USD on Arbitrum). Snapshots the open price at market start, the close price at end. Drives win/loss.
- **Matching engine** — off-chain CLOB. Orders match on (price, time) priority. Settlement is on-chain per fill via the relayer hot wallet.

---

## REST endpoints

### `GET /version`

```json
{
  "commit": "c1eb901abafddeb363230a06bf9ec2bb7dcd0439",
  "bootedAt": "2026-04-29T10:06:19.206Z",
  "env": "development",
  "nodeVersion": "v22.22.2"
}
```

Not rate limited. Cheap probe for "did the deploy land?"

### `GET /health`

```json
{ "status": "ok", "relayer": "0x5AFAb...", "uptime": 16199.98 }
```

Not rate limited. Use for status indicators.

### `GET /config`

Public chain + EIP-712 + fee config. **Multi-pair shape** — read `pairs[]` to discover supported markets.

```json
{
  "chainId": 42161,
  "usdtAddress": "<USDT_ADDRESS>",
  "relayerAddress": "<RELAYER_ADDRESS>",
  "platformFeeBps": 70,
  "makerFeeBps": 80,
  "feeModel": "probability-weighted",
  "peakFeeBps": 150,
  "dmmRebateBps": 30,
  "usdtDecimals": 6,
  "pairs": [
    {
      "pairId": "BTC-USD",
      "settlementAddress": "<settlement>",
      "autocyclerAddress": "0x4dee00a7a5372ecbf1f473e580753f1f4a7e98a7",
      "eip712": {
        "domain": {
          "name": "UpDown Exchange",
          "version": "1",
          "chainId": 42161,
          "verifyingContract": "<settlement>"
        }
      }
    }
  ],
  "settlementAddress": "<settlement>",
  "eip712": { "domain": { "...": "..." } }
}
```

**Deprecation:** the top-level `settlementAddress` and `eip712.domain` fields hold the **first pair's** values for backward-compat with single-pair clients. They will be removed one release cycle after every active client reads from `pairs[]`. Migrate now.

**Live addresses are authoritative** — pull them from `GET /config` at runtime, do not hardcode. Contract bundles can redeploy (a fresh deploy happened on 2026-05-04 as part of PR-5-bundle); the addresses above are the post-bundle dev set as of writing. SDK examples (`sdk/typescript/examples/*.ts`) all read from `/config` at startup — the recommended pattern.

### `GET /markets`

Optional query: `timeframe=300|900|3600`, `pair=BTC-USD|ETH-USD`.

```json
[
  {
    "address": "<settlement>-420",
    "marketId": "420",
    "settlementAddress": "<settlement>",
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

### `GET /markets/:address`

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

### `GET /orderbook/:marketAddress`

Full book per side. Prices are in **basis points** (1¢ = 100 bps; 50¢ = 5000 bps).

```json
{
  "up":   { "bids": [{ "price": 4500, "depth": "...", "count": 3 }], "asks": [] },
  "down": { "bids": [], "asks": [] }
}
```

### `GET /balance/:wallet`

```json
{
  "wallet": "0xabc...",
  "smartAccountAddress": "0xabc...",
  "available": "65000000",
  "inOrders": "0",
  "cachedBalance": "65000000",
  "balanceLastSyncedAt": "2026-04-29T10:38:20.546Z",
  "withdrawNonce": 0
}
```

In Path-1 the `cachedBalance` mirrors the **on-chain USDT balance of the EOA itself**. `available = cachedBalance − inOrders`. Frontend derives `inOrders` from the open-orders list rather than this field — the backend's `inOrders` has a known slow-leak (filed) and may drift higher than the actual locked sum.

### `GET /positions/:wallet`

```json
[
  {
    "market": "<settlement>-420",
    "marketStatus": "ACTIVE",
    "option": 1,
    "optionLabel": "UP",
    "shares": "5000000",
    "avgPrice": 5500,
    "costBasis": "2750000"
  }
]
```

`shares` is the notional (atomic USDT). `avgPrice` in bps. `costBasis = shares × avgPrice / 10000`.

### `GET /trades/:wallet`

Per-wallet trade history. Paginated via `?limit=&offset=`.

### `GET /orders/:wallet`

Open + recent orders for a wallet. Filter via `?status=OPEN&status=PARTIALLY_FILLED&limit=50`.

```json
{
  "orders": [
    {
      "orderId": "e121947b-...",
      "maker": "0xabc...",
      "market": "<settlement>-420",
      "option": 1,
      "side": 0,
      "type": 1,
      "price": 0,
      "amount": "5000000",
      "filledAmount": "5000000",
      "nonce": "101506360828",
      "expiry": "1777458900",
      "status": "FILLED",
      "createdAt": "2026-04-29T10:31:37.401Z"
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0
}
```

`nonce` and `expiry` are returned as **JSON strings** (not numbers). The backend's `OrderModel` schema stores both as `String` per the PR-13.1 hotfix to preserve the full uint256 precision the contract verifies against. Number-typed consumers silently truncate above `2^53` — exactly the breakage that fix closed. Parse via `BigInt(orders[i].nonce)` if you need numeric arithmetic; pass the string straight through to `signTypedData` if you're round-tripping (viem accepts string-form bigints in typed-data messages).

### `POST /orders`

Place an order. Body **and** an EIP-712 signature.

```json
{
  "maker": "0xabc...",
  "market": "<settlement>-420",
  "option": 1,
  "side": 0,
  "type": 1,
  "price": 0,
  "amount": "5000000",
  "nonce": 101506360828,
  "expiry": 1777458900,
  "signature": "0x..."
}
```

Field semantics:

| Field | Type | Meaning |
|---|---|---|
| `option` | `1 \| 2` | 1 = UP, 2 = DOWN |
| `side` | `0 \| 1` | 0 = BUY, 1 = SELL |
| `type` | `0 \| 1 \| 2 \| 3` | LIMIT \| MARKET \| POST_ONLY \| IOC |
| `price` | bps | 1–9999 for LIMIT/POST_ONLY/IOC; **0** for MARKET |
| `amount` | atomic USDT | 1 USDT = 1_000_000 |
| `nonce` | uint | Any unique number per order |
| `expiry` | unix sec | Backend rejects past expiry |

Returns `201 { id, status, market, option, side, type, price, amount, createdAt }`. Errors return `4xx { error: "..." }`.

#### EIP-712 typed data

Sign with the **domain matching the market's settlement** (`pairs[i].eip712.domain` where `pairs[i].settlementAddress === parseComposite(market).settlementAddress`). All pairs currently share one settlement, but the lookup is required for forward compatibility.

```ts
const domain = {
  name: "UpDown Exchange",
  version: "1",
  chainId: 42161,
  verifyingContract: "<pair.settlementAddress>",
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

#### Order types

| `type` | Name | Behavior |
|---|---|---|
| `0` | LIMIT | Rests on book at `price` if no immediate match, else partials fill against the book |
| `1` | MARKET | Hits the book at the prevailing best-ask (BUY) / best-bid (SELL); price field must be `0` |
| `2` | POST_ONLY | Rejected if it would cross the book (`400 "POST_ONLY order would match immediately"`); else rests |
| `3` | IOC | Fill-or-cancel: matches what's available at `price` or better, cancels the remainder |

#### Stake bounds

Orders must satisfy `$5 ≤ stake ≤ $500` USDT (= `5_000_000 ≤ amount ≤ 500_000_000` atomic). The backend enforces **both bounds** at the API boundary via `lib/stakeBounds.ts:checkStakeBounds(...)` before signature verification — out-of-range submissions return `400` with a stake-bound error string. Frontend mirrors the same bounds for UX. Defense-in-depth: validate client-side too, so a bad value never produces a signed payload at all.

### `DELETE /orders/:orderId`

Body: `{ "maker": "0xabc...", "signature": "0x...", "nonce": "<uint256>", "expiry": <unixSec> }` where the signature is EIP-712 over a `Cancel` message. **PR-13 (P1-4)** added `nonce` + `expiry` to the signed payload so a captured cancel sig can't be replayed forever; mirrors Polymarket's clob-client cancel typed-data shape.

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

The cancel signature uses the same per-pair domain as the original order — derive from the order's `market` composite key.

Field semantics:

| Field | Type | Meaning |
|---|---|---|
| `nonce` | uint256 | Unique per cancel — captured by the backend's replay cache for 5 min. **Send as a JSON string** (or `number` ≤ 2^53) — PR-13.1 hotfix preserves full uint256 precision over the wire so generators emitting values past 2^53 (e.g. Polymarket clob-client `freshCancelNonce`) round-trip cleanly. |
| `expiry` | unix sec | Backend rejects past-`expiry` cancels. |

Backend rejects on:
- Past `expiry` → `404 "Order not found"` (info-disclosure-collapsed; see comment in `routes/orders.ts`)
- Replayed `(maker, nonce)` within 5 min → `404 "Order not found"`
- Bad sig / wrong maker / unknown order / already-cancelled / already-filled → all return the same `404 "Order not found"`
- Order found, owner matches, sig valid, but market no longer ACTIVE → `400 "Market is no longer active"` (legitimate maker on closed market — distinct on purpose).

Returns `200 { id, status: "CANCEL_PENDING" }`. The matching engine releases the locked collateral and emits an `order_update` with `status="CANCELLED"` once processed.

### `POST /markets/:address/claim`

Relayer / admin only. Headers: `x-updown-admin-key: <CLAIM_ADMIN_API_KEY>` OR body `{ "signature": "<EIP-191 sig from relayer over 'updown:claim:<address>:<chainId>'>" }`. End users do NOT call this — winnings auto-claim.

### `GET /stats`

```json
{ "totalVolume": "640000000", "activeMarketsCount": 6, "totalTraders": 6 }
```

### `GET /prices/history/:symbol`

Proxied chart data. `symbol` ∈ `BTC | ETH`. Returns the upstream feed's price series for the chart panel.

### `GET /admin/*`, `GET /devdmm/health`

Operational endpoints. `/admin` is gated by `x-updown-admin-key`; `/devdmm/health` is open in dev (no secrets, just per-pair telemetry).

---

## WebSocket

Connect to `/stream`. Public channels (`markets`, `orderbook:*`, `trades:*`) can be subscribed directly; **per-wallet channels (`orders:<wallet>`, `balance:<wallet>`) require the EIP-712 auth handshake described below** before the subscribe will return events.

### Public-only subscribe (no auth)

```json
{ "type": "subscribe", "channels": ["markets", "orderbook:<settlement>-420"] }
```

Server responds `{ "type": "subscribed", "channels": [...] }`. Each channel's events arrive as `{ "type": "<event>", "channel": "<channel>", "data": { "...": "..." } }`.

### Authenticated subscribe (required for `orders:*` and `balance:*`)

PR-19 (P0-18) added a signed handshake that gates per-wallet channels. Without it the server silently never delivers `orders:<wallet>` or `balance:<wallet>` events even after a `subscribed` ack — anonymous clients used to be able to read any wallet's events, which was the bug PR-19 closed.

**Step 1 — sign EIP-712 `WsAuth` typed-data.** Distinct domain from order signing (so an order signature can never be replayed as a WS-auth signature):

```ts
const wsAuthDomain = {
  name: "PulsePairs WebSocket Auth",
  version: "1",
  chainId: 42161,
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
  wallet,                                       // your address
  timestamp: BigInt(Math.floor(Date.now()/1000)),
  sessionId: "0x" + crypto.randomBytes(32).toString("hex"), // fresh per handshake
};
const signature = await walletClient.signTypedData({
  account: wallet, domain: wsAuthDomain, types: wsAuthTypes,
  primaryType: "WsAuth", message,
});
```

**Step 2 — send `auth` over the open socket.**

```json
{
  "type": "auth",
  "wallet": "0xabc...",
  "timestamp": "1777888888",
  "sessionId": "0xfeed...beef",
  "signature": "0x..."
}
```

Server validates: `timestamp` within ±60s of server clock, `(wallet, sessionId)` not already-seen within the timestamp window (replay protection), signature recovers to `wallet` (handles plain EOAs and ERC-1271 contract accounts via viem's `verifyTypedData`).

**Step 3 — receive `auth_ok` (or `auth_error`).**

```json
{ "type": "auth_ok", "wallet": "0xabc...", "token": "<32-byte hex>", "expiresAt": 1777975288 }
```

Token is a server-issued opaque session token, valid 24h, **server-memory only** (no persistence across pm2 reload — re-auth is one signature). Cache the token in JS memory only (NOT localStorage — closed tab forces re-auth, which is correct for a session token).

```json
{ "type": "auth_error" }
```
**No `reason` field — deliberate.** The server emits a bare `auth_error` so a probe can't distinguish "bad signature" from "timestamp drift" from "sessionId reused" via timing or response shape. Common real causes (debug client-side): `timestamp outside ±60s window` (clock skew), `sessionId reused` (use a fresh 32-byte random per handshake), `invalid signature` (wrong domain — must be `PulsePairs WebSocket Auth`, not the order-signing domain).

**Step 4 — subscribe to per-wallet channels.**

```json
{ "type": "subscribe", "channels": ["orders:0xabc...", "balance:0xabc..."] }
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

Atomic on-chain settlement (PR-5-bundle, Polymarket parity). Every fill produces a single `enterPosition` tx that pulls the buyer's USDT and pays seller / treasury / maker in one atomic step — no parallel off-chain ledger.

1. Maker signs `Order` against `pair.eip712.domain`, POSTs.
2. Backend verifies signature (`viem.verifyTypedData` — supports EOA + ERC-1271 contract-account makers).
3. Order enters the matching engine. If filled, the engine writes a `Trade` row recording `sellerReceives = (price × fillAmount) / 10000` (formula (c) — clean price-based proceeds, fees taken from the buyer's residual) and `makerFeeRecipient = order.maker` (the resting-side maker, regardless of side — closes P0-17).
4. `SettlementService` picks up the trade and calls `settlement.enterPosition(FillInputs)` from the relayer EOA. The struct carries `{ order, signature, marketId, option, fillAmount, taker, sellerReceives, platformFee, makerFee, makerFeeRecipient }`. The contract is `onlyRelayer` (closes P0-13) — no third-party fills with leaked signatures.
5. Inside `enterPosition` (atomic):
   - `USDT.transferFrom(buyer, settlement, fillAmount)`
   - `USDT.transfer(seller, sellerReceives)` (skipped if `seller == address(0)` — initial issuance)
   - `USDT.transfer(treasury, platformFee)`
   - `USDT.transfer(makerFeeRecipient, makerFee)` — paid to **every** maker, not just registered DMMs
   - Contract retains `residual = fillAmount − sellerReceives − platformFee − makerFee = (1 − price/10000) × fillAmount − fees`. Residual is the buyer's at-risk capital backing winning `Position.netShares × $1` at resolution.
6. Maker's order is marked `FILLED` (or `PARTIALLY_FILLED`). `Trade.settlementStatus` flips `PENDING → SUBMITTED → CONFIRMED`. WS pushes `order_update`.

**Failure path.** If `enterPosition` reverts (insufficient allowance / balance / market-ended race), the trade is marked `FAILED` after `MAX_SETTLEMENT_RETRIES`. Atomic settlement means no on-chain transfer happened, so there's nothing to claw back from treasury or seller — only the buyer's submit-time `inOrders` lock is restored via `restoreSmartAccountInOrders(buyer, fillAmount)`. PR-9's `REVERSED_MARKET_RESOLVED` path follows the same shape.

**SELL-side collateral.** SELL orders commit shares (`reserveSharesForSell`), not USDT. Pre-bundle the engine locked USDT for both sides — that off-by-one was the surface of P0-7 (a SELL maker with valid share inventory but no USDT was rejected). Fixed: `lockSmartAccountInOrders` is gated by `if (sideEnum === OrderSide.BUY)`.

---

## Resolution flow (per market)

1. Market `endTime` passes — `MarketSyncer` flips status `ACTIVE → TRADING_ENDED`.
2. AutoCycler's next upkeep tick (Chainlink Automation in prod, cron stopgap on dev) calls `resolver.resolve(marketId)`.
3. `Resolver` reads the Chainlink price at the market's end timestamp, compares to the strike snapshotted at market start, sets the winner on the settlement contract. Status flips to `RESOLVED`.
4. `ClaimService` calls `settlement.withdrawSettlement(marketId)` to drain the contract's accumulated residuals to the relayer EOA. The contract sets `m.settled = true`.
5. `ClaimService.distributeWinnings` reads winning-side `Position.netShares` (= `sharesBought − sharesSold`) per holder via `getNetSharesByHolder(market, winningOption)`. Each winner gets a `usdt.transfer(wallet, netShares)` from the relayer (1 share = $1 USDT atomic — binary winner-takes-all). `ClaimPayoutLog` rows persist the per-(market, wallet) two-phase commit (PR-6 / P0-8).
6. Losing-side positions receive nothing — `getNetSharesByHolder` filters them out.
7. Rounding leftover (`dust = relayerBalanceBefore − totalDistributed`) is forwarded on-chain to the treasury EOA via `usdt.transfer(treasury, dust)`. If `treasury == relayer` (default dev setup), dust stays on the relayer and the script logs the no-op. Status flips to `CLAIMED`.

If the auto-claim path stalls (RPC rate-limit, gas spike), Portfolio surfaces a manual `Claim` button that nudges the relayer to retry. Funds never strand on-chain — they wait on the contract until claimed.

**Source of truth (PR-5-bundle).** At-resolution payouts are funded by the contract's per-fill residual pool (drained in step 4) and sized by `Position.netShares × $1` (the binary CTF model). Pre-bundle the formula was `(position × totalPool) / totalWinningBought` summed over `TradeModel.amount` — a parimutuel calculation that miscomputed payouts whenever shares changed hands mid-market (secondary-market sellers were double-counted; winners short-paid). PR-5-bundle closes that as an intentional side effect of the funding-model migration.

---

## Fees

Probability-weighted: a 50¢ trade pays the peak rate, extremes taper to nearly zero.

```
weight       = 4 × p × (1 − p),  with p = price / 10000  (price in bps)
totalFeeBps  = platformFeeBps + makerFeeBps  // default 70 + 80 = 150
effectiveBps = totalFeeBps × weight
feeUsd       = notionalUsd × effectiveBps / 10000
```

At 50¢: `weight = 1`, fee = 1.5%. At 90¢: `weight ≈ 0.36`, fee ≈ 0.54%. Read `/config` for live values.

**Fee incidence** (PR-5-bundle): under formula (c), fees come from the buyer's residual portion (`(1 − price/10000) × fillAmount`), NOT from the seller's proceeds. The seller receives the clean price-based amount `(price × fillAmount) / 10000`. Pre-bundle the engine deducted fees from `sellerReceives` (`sellerReceives = fillAmount − fees`); post-bundle the engine writes `sellerReceives = (price × fillAmount) / 10000` to the Trade record and the contract validates `sellerReceives + platformFee + makerFee ≤ fillAmount` before transferring.

**Maker rebate** (PR-5-bundle, P0-17 — closed): every maker — not just registered DMMs — receives `makerFee` atomically as part of `enterPosition`. Pre-bundle the rebate path (`DMMService.applyRebate`) early-returned for non-DMM makers; this PR routes the rebate uniformly via the contract's `makerFeeRecipient = order.maker`.

DMMs (registered via on-chain `addDMM`) additionally earn `dmmRebateBps` (default 30 = 0.3%) — the *bonus* tier on top of the universal maker rebate. Bonus accumulates per-pair on the settlement contract and is claimed via the relayer.

---

## Rate limits

- **Global REST** (excluding `/health`): ~400 req/min/IP
- **Order writes** (`POST /orders`, `DELETE /orders/:id`): ~90 req/min/IP

`429 Too Many Requests` with JSON `{ "error": "..." }`. Back off exponentially.

A per-wallet rate limit is on the Phase 6b backlog.

---

## Errors

All errors are `4xx` or `5xx` JSON: `{ "error": "<short message>" }`. Frontend maps a curated set of these to user-facing strings via `formatUserFacingError` — see `updown-frontend/src/lib/errors.ts` for the canonical mapping. Notable strings (do **not** rename without a migration):

- `Insufficient balance` → "Insufficient USDT balance."
- `Market not active` → "This market has ended. Open the live market and try again."
- `Invalid signature` → "Wallet signature couldn't be verified. Please try again."
- `POST_ONLY order would match immediately` → "Post-only would have filled immediately. Try a price further from the book."

---

## Multi-pair routing checklist

When adding a third pair (or running a second instance against a different settlement), audit every callsite that uses `pairs[0]` as a stand-in for "the only pair":

- Frontend: `/config`'s legacy top-level `settlementAddress` is the FIRST pair — multi-pair clients must read `pairs[]`.
- Backend: every per-market operation (signature verify, settlement, claim, fee withdraw, DMM rebate) routes by the market's `settlementAddress`, looked up via `findPairBySettlement(...)`. Order-flow tests in `src/services/*.test.ts` cover the boundary.

---

## Versioning

Breaking changes get a single release cycle of overlap. The deprecated top-level `/config` fields will be removed when (a) all internal frontends + SDKs read from `pairs[]` AND (b) at least 30 days have passed since the deprecation note shipped.
