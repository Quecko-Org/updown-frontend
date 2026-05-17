"use client";

import { useState } from "react";
import { OrderBookPanel } from "@/components/OrderBook";

type Props = {
  marketId: string | null;
  marketStatus?: string;
};

export function OrderBookDrawer({ marketId, marketStatus }: Props) {
  const [open, setOpen] = useState(false);

  if (!marketId) return null;

  return (
    <section
      className={
        open ? "pp-orderbook-drawer pp-orderbook-drawer--open" : "pp-orderbook-drawer"
      }
    >
      <button
        type="button"
        className="pp-orderbook-drawer-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="pp-orderbook-drawer-body"
      >
        <span className="pp-orderbook-drawer-toggle-label">Order book</span>
        <span className="pp-orderbook-drawer-toggle-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="pp-orderbook-drawer-body" id="pp-orderbook-drawer-body">
          <OrderBookPanel marketId={marketId} marketStatus={marketStatus} />
        </div>
      ) : null}
    </section>
  );
}
