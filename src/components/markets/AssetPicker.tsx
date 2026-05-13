"use client";

import { CryptoIcon } from "@/components/icons/CryptoIcon";

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
          <CryptoIcon symbol="BTC" size={16} />
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
          <CryptoIcon symbol="ETH" size={16} />
        </span>
        <span>ETH</span>
        {selected === "eth" && formatSpot(ethSpotUsd) && (
          <span className="pp-asset-pill__price">{formatSpot(ethSpotUsd)}</span>
        )}
      </button>
    </div>
  );
}
