"use client";

import { Bitcoin } from "lucide-react";

export type Asset = "btc" | "eth";

export type AssetPickerProps = {
  selected: Asset;
  /**
   * Optional spot prices to render inside the active pill. Mono-numeric,
   * dimmed slightly relative to the ticker label. Passed through from the
   * page's spot-price hook; if omitted, the price slot stays empty.
   */
  btcSpotUsd?: number | null;
  ethSpotUsd?: number | null;
  onChange: (asset: Asset) => void;
};

function formatSpot(usd: number | null | undefined): string | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// Inline glyph for Ethereum — lucide-react has no Ethereum icon; using
// the Unicode Ξ keeps the icon family consistent at the same x-height
// without pulling in a second icon dependency.
function EthGlyph() {
  return (
    <span
      aria-hidden="true"
      style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 14, lineHeight: 1 }}
    >
      Ξ
    </span>
  );
}

export function AssetPicker({ selected, btcSpotUsd, ethSpotUsd, onChange }: AssetPickerProps) {
  return (
    <div className="pp-asset-pickers" role="group" aria-label="Asset">
      <button
        type="button"
        className={`pp-asset-pill ${selected === "btc" ? "pp-asset-pill--active" : ""}`}
        onClick={() => onChange("btc")}
        aria-pressed={selected === "btc"}
      >
        <span className="pp-asset-pill__icon">
          <Bitcoin size={14} />
        </span>
        <span>BTC</span>
        {selected === "btc" && formatSpot(btcSpotUsd) && (
          <span className="pp-asset-pill__price">{formatSpot(btcSpotUsd)}</span>
        )}
      </button>
      <button
        type="button"
        className={`pp-asset-pill ${selected === "eth" ? "pp-asset-pill--active" : ""}`}
        onClick={() => onChange("eth")}
        aria-pressed={selected === "eth"}
      >
        <span className="pp-asset-pill__icon">
          <EthGlyph />
        </span>
        <span>ETH</span>
        {selected === "eth" && formatSpot(ethSpotUsd) && (
          <span className="pp-asset-pill__price">{formatSpot(ethSpotUsd)}</span>
        )}
      </button>
    </div>
  );
}
