"use client";

export type Timeframe = "5m" | "15m" | "60m";

const OPTIONS: Timeframe[] = ["5m", "15m", "60m"];

export type TimeframeSegmentedProps = {
  selected: Timeframe;
  onChange: (timeframe: Timeframe) => void;
};

export function TimeframeSegmented({ selected, onChange }: TimeframeSegmentedProps) {
  return (
    <div className="pp-seg" role="tablist" aria-label="Timeframe">
      {OPTIONS.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          aria-selected={selected === tf}
          className={`pp-seg__btn ${selected === tf ? "pp-seg__btn--on" : ""}`}
          onClick={() => onChange(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
