"use client";

export type RowsMode = "live" | "resolved";

export type LiveResolvedToggleProps = {
  value: RowsMode;
  onChange: (mode: RowsMode) => void;
};

export function LiveResolvedToggle({ value, onChange }: LiveResolvedToggleProps) {
  return (
    <div className="pp-seg" role="tablist" aria-label="Markets view">
      <button
        type="button"
        role="tab"
        aria-selected={value === "live"}
        className={`pp-seg__btn ${value === "live" ? "pp-seg__btn--on" : ""}`}
        onClick={() => onChange("live")}
      >
        Live
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "resolved"}
        className={`pp-seg__btn ${value === "resolved" ? "pp-seg__btn--on" : ""}`}
        onClick={() => onChange("resolved")}
      >
        Resolved
      </button>
    </div>
  );
}
