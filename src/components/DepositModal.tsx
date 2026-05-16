"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Modal } from "./Modal";
import { activeChain, tokenSymbolForActiveChain } from "@/config/environment";
import { postDevmintUsdt } from "@/lib/api";
import { formatUserFacingError } from "@/lib/errors";

type Props = {
  open: boolean;
  onClose: () => void;
  depositAddress: string;
};

/**
 * F3 (2026-05-16): on testnet, fresh users land with 0 USDTM and no way
 * to acquire some without Meir running cast send. The "Get test USDTM"
 * button below the QR mints $100 USDTM to their ThinWallet via the
 * relayer (`POST /test/devmint`). Rate-limited at 1 per address per 5min.
 *
 * Production safety (Layer 1): button is gated to chainId 421614 (Sepolia)
 * — `isTestnet === false` returns null, so mainnet users never see it.
 * Layer 2 (backend route 404 on NODE_ENV=production) and Layer 3
 * (Playwright assertion in phase-4d ladder) cover the residual surface.
 */
const TESTNET_MINT_AMOUNT_ATOMIC = "100000000"; // 100 USDTM (6 decimals)

export function DepositModal({ open, onClose, depositAddress }: Props) {
  const address = depositAddress || "";
  const canCopy = address.length > 0;
  const tokenSymbol = tokenSymbolForActiveChain();
  const chainName = activeChain.name;
  const isTestnet = activeChain.id === 421614;
  const [minting, setMinting] = useState(false);

  function copy() {
    if (!canCopy) return;
    navigator.clipboard.writeText(address);
    toast.success("Address copied");
  }

  async function mintTestnetUsdt() {
    if (!canCopy) return;
    setMinting(true);
    try {
      const result = await postDevmintUsdt({
        address: address as `0x${string}`,
        amount: TESTNET_MINT_AMOUNT_ATOMIC,
      });
      toast.success(`Minted 100 ${tokenSymbol} — tx ${result.txHash.slice(0, 10)}…`);
    } catch (e) {
      toast.error(formatUserFacingError(e));
    } finally {
      setMinting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Deposit ${tokenSymbol}`} width={420}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Send {tokenSymbol} on {chainName} to the smart-account address below. Funds stay under your control — the backend
        only uses them for trades you authorize.
      </p>

      <div className="pp-kv" style={{ marginTop: 14 }}>
        <span className="pp-micro">Network</span>
        <span className="pp-body-strong">{chainName}</span>
        <span className="pp-micro">Asset</span>
        <span className="pp-body-strong">{tokenSymbol}</span>
      </div>

      <div className="pp-qr" style={{ padding: "18px 0" }}>
        <QRCodeSVG value={address || " "} size={140} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>

      <div>
        <span className="pp-micro">Address</span>
        <p
          className="pp-hash"
          style={{
            marginTop: 4,
            padding: "10px 12px",
            background: "var(--bg-0)",
            border: "1px solid var(--border-0)",
            borderRadius: 4,
            color: "var(--fg-0)",
            wordBreak: "break-all",
          }}
        >
          {address || "—"}
        </p>
      </div>

      <button
        type="button"
        className="pp-btn pp-btn--primary pp-btn--lg pp-modal__cta"
        onClick={copy}
        disabled={!canCopy}
      >
        Copy address
      </button>

      {isTestnet && (
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--md"
          style={{ marginTop: 10, width: "100%" }}
          onClick={mintTestnetUsdt}
          disabled={!canCopy || minting}
          data-testid="deposit-get-test-usdtm"
        >
          {minting ? "Minting…" : `Get 100 ${tokenSymbol} (testnet)`}
        </button>
      )}
    </Modal>
  );
}
