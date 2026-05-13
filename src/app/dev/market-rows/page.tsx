"use client";

import { notFound } from "next/navigation";
import type { MarketListItem } from "@/lib/api";
import { LiveMarketRow } from "@/components/markets/LiveMarketRow";
import { OpenMarketRow } from "@/components/markets/OpenMarketRow";
import { NextMarketRow } from "@/components/markets/NextMarketRow";

const nowSec = () => Math.floor(Date.now() / 1000);

function mockMarket(overrides: Partial<MarketListItem>): MarketListItem {
  const now = nowSec();
  return {
    address: "0xmock-0",
    pairId: "BTC-USD",
    pairSymbol: "BTC-USD",
    chartSymbol: "BTC",
    startTime: now - 60,
    endTime: now + 240,
    duration: 300,
    status: "ACTIVE",
    winner: null,
    upPrice: "5400",
    downPrice: "4600",
    strikePrice: "103189",
    volume: "184.50",
    ...overrides,
  };
}

export default function MarketRowsDevPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  const now = nowSec();
  return (
    <div
      style={{
        background: "var(--bg-0)",
        minHeight: "100vh",
        padding: "48px 24px",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 22,
            color: "var(--fg-0)",
            margin: "0 0 24px",
          }}
        >
          Market row components — PR-2 preview
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--fg-2)",
            margin: "0 0 32px",
          }}
        >
          Stack reads top-to-bottom as a temporal flow: happening now → coming
          up → upcoming. Numerals are Geist Mono throughout. Live row carries
          the <code>--shadow-live</code> ambient glow; Next rows fade
          progressively by depth.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <LiveMarketRow
            market={mockMarket({
              address: "0xmock-live",
              startTime: now - 166,
              endTime: now + 134,
              strikePrice: "103189",
              volume: "421.18",
            })}
            countdownSeconds={134}
            upTraderCount={18}
            downTraderCount={11}
            upPct={62}
            downPct={38}
          />

          <OpenMarketRow
            market={mockMarket({
              address: "0xmock-open",
              startTime: now,
              endTime: now + 300,
              strikePrice: "103247",
              volume: "184.50",
            })}
            upSharePriceCents={54}
            downSharePriceCents={46}
            upPct={54}
            downPct={46}
            poolUsdt={184.5}
            traderCount={7}
            countdownSecondsUntilClose={134}
            onSelectSide={() => {}}
          />

          <NextMarketRow
            market={mockMarket({
              address: "0xmock-next-0",
              startTime: now + 300,
              endTime: now + 600,
              strikePrice: undefined,
              volume: "0",
            })}
            upSharePriceCents={50}
            downSharePriceCents={50}
            secondsUntilOpen={245}
            depth={0}
          />

          <NextMarketRow
            market={mockMarket({
              address: "0xmock-next-1",
              startTime: now + 600,
              endTime: now + 900,
              strikePrice: undefined,
              volume: "0",
            })}
            upSharePriceCents={50}
            downSharePriceCents={50}
            secondsUntilOpen={545}
            depth={1}
          />

          <NextMarketRow
            market={mockMarket({
              address: "0xmock-next-2",
              startTime: now + 900,
              endTime: now + 1200,
              strikePrice: undefined,
              volume: "0",
            })}
            upSharePriceCents={50}
            downSharePriceCents={50}
            secondsUntilOpen={845}
            depth={2}
          />
        </div>
      </div>
    </div>
  );
}
