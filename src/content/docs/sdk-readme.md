<!-- AUTO-COPIED — do not edit, regenerate from updown-backend -->
# @updown/sdk (TypeScript)

HTTP + WebSocket client for the UpDown matching engine API. Path-1 architecture: USDT lives on your EOA, you sign EIP-712 typed-data per order, the relayer broadcasts atomic on-chain settlement.

**Status:** dev. Mainnet bundle TBD.

---

## Install

```bash
npm install @updown/sdk
# or, while developing in-tree:
cd sdk/typescript && npm install && npm run build
```

Peer requirement: `viem` (already a transitive dependency of the SDK).

---

## Quickstart

The fastest path is `examples/simple-taker.ts`. It places one MARKET BUY against the live BTC-USD book and prints the resulting trade.

```bash
cd sdk/typescript
TRADER_PRIVATE_KEY=0x... \
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc \
UPND_API=https://dev-api.pulsepairs.com \
  npx ts-node examples/simple-taker.ts
```

The example:

1. Reads `GET /config` for live contract addresses + EIP-712 domain (**never hardcode addresses** — bundles can redeploy).
2. Calls `ensureSettlementAllowance(...)` once per wallet to authorize the settlement contract to pull USDT (idempotent; only re-approves below the 10k-USDT floor).
3. Picks an ACTIVE 5-minute BTC-USD market from `GET /markets?pair=BTC-USD&timeframe=300`.
4. Builds an `Order` typed-data payload with `buildOrderTypedData(...)`, signs it via the connected wallet client, and POSTs to `/orders`.
5. Polls `/orders/:wallet/:orderId` until `status === "FILLED"`.

`examples/simple-maker.ts` is the LIMIT-rest analogue (places a LIMIT BUY, subscribes to `orders:<wallet>` over WebSocket via the authed handshake, prints the fill event when it lands).

`examples/full-dmm-bot.ts` shows the maker pattern: authed WS subscription, two-sided LIMIT quotes that re-post on fill, cancel-and-repost on price move.

---

## Modules

```
sdk/typescript/src/
  index.ts        Re-exports everything.
  http.ts         Tiny fetch wrapper used internally.
  approve.ts      ensureSettlementAllowance(walletClient, pc, usdt, settlement)
                  — idempotent USDT approve, only fires below threshold.
  eip712.ts       ORDER_TYPES, CANCEL_TYPES, WS_AUTH_TYPES (PR-19),
                  buildOrderTypedData(), buildCancelTypedData(),
                  buildWsAuthTypedData(), freshSessionId(),
                  domainForSettlement(), parseCompositeMarketKey(),
                  centsToBps(), parseStake(), feeAtomic().
  ws.ts           UpDownWsClient — exposes `connectPublic(channels)` and
                  `connectAuthed({ signAuth, channels })`. Caches the
                  24h session token in-memory, replays on reconnect,
                  only re-prompts signing if the cached token is
                  rejected. Auto-reconnect with exponential backoff.
  types.ts        ApiConfig, OrderRow, Trade, Position, Balance, Market,
                  Option (= 1=UP, 2=DOWN), OrderSide, OrderType (= 0=LIMIT,
                  1=MARKET, 2=POST_ONLY, 3=IOC).
```

---

## Field-name gotchas (live with them)

- `OrderRow.nonce` and `OrderRow.expiry` are returned by the REST API as **JSON strings** (post-PR-13.1 hotfix to preserve full uint256 precision). Number-typed consumers truncate above `2^53`. Pass the strings through to `signTypedData` (viem accepts string-form bigints) or parse via `BigInt(o.nonce)`.
- WS `order_update` payload uses `orderType`; REST `OrderRow` uses `type`. Same value, different field name on different surfaces. Don't try to unify them — both are pinned by tests on either side.
- `Option` is `1 = UP`, `2 = DOWN` — **not** `0/1`. Frontend convention is `option === 1 ? UP : DOWN`.
- Market addresses are composite: `<settlementAddress>-<marketId>`. The signed `Order.market` field is the **bare uint256 marketId**, not the composite string. The composite goes in the POST body's `market` field for routing only.

---

## Reference

The canonical wire-shape doc is `docs/api.md` at the repo root. It covers every endpoint, the WS auth handshake (the part most external bot devs miss), error strings, and the settlement / resolution / fee flows post-PR-5-bundle. Read that for anything beyond the example surface.

---

## License

UNLICENSED — internal until mainnet.
