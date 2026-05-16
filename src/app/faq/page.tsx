"use client";

import Link from "next/link";
import { activeChain, tokenSymbolForActiveChain } from "@/config/environment";

/**
 * PR-5: full Phase-4 rewrite. Earlier copy described the Path-1 EOA-direct
 * architecture (USDT in your wallet, you pay gas on first approval). Under
 * Phase 4 the trading account is a per-user ThinWallet smart account; the
 * EOA never holds trading funds and never pays gas. Chain-aware copy via
 * `activeChain.name` + `tokenSymbolForActiveChain()` so the same string
 * pool serves Sepolia dev and mainnet.
 */

type FaqItem = { q: string; a: React.ReactNode };

function buildFaq(): FaqItem[] {
  const chain = activeChain.name; // "Arbitrum One" | "Arbitrum Sepolia"
  const tokenSym = tokenSymbolForActiveChain(); // "USDT" | "USDTM"

  return [
    {
      q: "How do PulsePairs markets work?",
      a: (
        <>
          Each market is a fixed-window prediction on whether BTC or ETH will
          close above (&ldquo;UP&rdquo;) or below (&ldquo;DOWN&rdquo;) its
          opening price within 5 minutes, 15 minutes, or 1 hour. The opening
          price (the <em>strike</em>) is snapshotted from the Chainlink
          BTC/USD or ETH/USD feed when the market opens. Buy UP shares if you
          think the price will be higher at the close, DOWN shares if you
          think it will be lower. Winning shares pay $1 each at resolution;
          losing shares pay $0.
        </>
      ),
    },
    {
      q: "What's a trading account / ThinWallet?",
      a: (
        <>
          Your trading account is a per-user smart contract called a{" "}
          <strong>ThinWallet</strong>, deployed once at first connect. It
          holds your {tokenSym} balance, signs orders, and is the on-chain
          counterparty in every settlement. Your wallet (MetaMask / Coinbase /
          WalletConnect) is the <em>owner</em> of this smart account — every
          action your ThinWallet takes requires your wallet&rsquo;s signature.
          You never give up custody; the ThinWallet is yours, deployed at a
          deterministic address only you can control.
        </>
      ),
    },
    {
      q: "Why do I need to sign twice to start?",
      a: (
        <>
          Two one-time signatures up front, then you&rsquo;re trading:
          <ol className="ml-5 mt-2 list-decimal space-y-1">
            <li>
              <strong>Identity sign</strong> — proves you own the wallet.
              The backend uses this signature to deploy your ThinWallet
              at the deterministic address derived from your wallet.
            </li>
            <li>
              <strong>Approve sign</strong> — authorizes the settlement
              contract to pull {tokenSym} from your ThinWallet at fill
              time. One-time per chain. Subsequent trades are just an
              order signature, no popup approval.
            </li>
          </ol>
          Both signatures are gasless — relayer broadcasts everything.
        </>
      ),
    },
    {
      q: "Do I pay gas?",
      a: (
        <>
          No. PulsePairs uses a meta-transaction model: you sign EIP-712
          envelopes, the relayer broadcasts the on-chain calls. The relayer
          pays gas in {activeChain.nativeCurrency.symbol} for every
          ThinWallet action — onboarding, approve, trade, withdraw. You
          never need to hold {activeChain.nativeCurrency.symbol} to use
          PulsePairs.
        </>
      ),
    },
    {
      q: "How do I deposit and withdraw?",
      a: (
        <>
          <strong>Deposit:</strong> send {tokenSym} to your trading account
          address. Open the Deposit modal from your wallet chip to copy the
          address or scan its QR. The address is deterministic per wallet —
          send to it from any source (CEX withdrawal, friend, another
          wallet).
          <br />
          <br />
          <strong>Withdraw:</strong> use the Withdraw modal. Enter a
          destination address + amount, sign the typed-data envelope. The
          relayer broadcasts a <code>{tokenSym}.transfer</code> from your
          ThinWallet. Destination receives {tokenSym} on {chain}. You pay
          zero gas.
        </>
      ),
    },
    {
      q: "What are the fees?",
      a: (
        <>
          Fees are <em>probability-weighted</em>: the closer your trade is to
          50¢ (a coin flip), the higher the percentage. Peak fee is{" "}
          <strong>1.5%</strong> at exactly 50¢, tapering to nearly zero at
          extremes. The formula is{" "}
          <code>fee = totalBps × 4 × p × (1 − p)</code>, where{" "}
          <code>p</code> is the trade&rsquo;s price as a probability and{" "}
          <code>totalBps</code> = 0.7% platform + 0.8% maker. Designated
          Market Makers (DMMs) earn a small bonus rebate on top of the
          maker fee for resolved trades — see{" "}
          <Link href="/fees" className="pp-link">
            /fees
          </Link>{" "}
          for the full schedule.
        </>
      ),
    },
    {
      q: "What happens if I win or lose?",
      a: (
        <>
          When the market resolves, the relayer automatically credits winning
          positions ($1 per winning share, minus fees) into your trading
          account ({tokenSym} balance increases). Losing positions go to $0.
          Auto-claiming usually completes within a few seconds. If the
          relayer is delayed, a manual <strong>Claim</strong> button appears
          in your Portfolio so you can nudge the credit yourself.
        </>
      ),
    },
    {
      q: "Why did my trade fail?",
      a: (
        <>
          Common reasons:
          <ul className="ml-5 mt-2 list-disc space-y-1">
            <li>
              <strong>Insufficient {tokenSym} balance</strong> — your trading
              account doesn&rsquo;t have enough {tokenSym} for the stake.
              Deposit more from the wallet chip.
            </li>
            <li>
              <strong>Market not active</strong> — the countdown crossed
              0:00 mid-flight; pick the next live market.
            </li>
            <li>
              <strong>POST-only would have crossed the book</strong> — your
              POST-only price would have filled immediately; pick a price
              further from the orderbook mid.
            </li>
            <li>
              <strong>Signature rejected</strong> — you declined the
              EIP-712 popup in your wallet.
            </li>
            <li>
              <strong>Network hiccup</strong> — RPC or relayer transient
              error; retry once.
            </li>
          </ul>
        </>
      ),
    },
    {
      q: "How is the price determined?",
      a: (
        <>
          Each side (UP / DOWN) trades on its own order book in cents. The
          midpoint between best bid and best ask is the implied probability:
          a UP price of 60¢ means the market collectively thinks there&rsquo;s
          a ~60% chance of an UP outcome at resolution. UP and DOWN cents sum
          to roughly 100¢ in a healthy book.
        </>
      ),
    },
    {
      q: "What chain is this on?",
      a: (
        <>
          PulsePairs runs on <strong>{chain}</strong> (chainId{" "}
          <code>{activeChain.id}</code>). All trading, settlement, and{" "}
          {tokenSym} custody happen on this chain. The connect flow
          auto-switches your wallet to {chain} — if your wallet is on a
          different network, the modal will prompt the switch before you
          can trade.
          {activeChain.id === 421614 && (
            <>
              <br />
              <br />
              <em>
                Note: {chain} is a testnet. {tokenSym} on this network is
                a throwaway test token (public mint) with no real-world
                value. Production deploys to Arbitrum One.
              </em>
            </>
          )}
        </>
      ),
    },
    {
      q: "What's the smallest trade size?",
      a: (
        <>
          Minimum stake is <strong>$5 {tokenSym}</strong>. Maximum is{" "}
          <strong>$500 {tokenSym}</strong> per order. Bigger positions are
          achievable by stacking multiple orders.
        </>
      ),
    },
    {
      q: "Are my funds custodial?",
      a: (
        <>
          No. Your ThinWallet is a smart contract <em>you</em> own — your
          wallet (the EOA) is set as the contract&rsquo;s <code>owner</code>{" "}
          at deployment and is the only address that can authorize moves.
          Every {tokenSym} transfer, withdraw, or trade settlement requires
          your wallet&rsquo;s signature, verified on-chain via ERC-1271. The
          relayer is the broadcaster — it pays gas and ferries your
          signatures to the chain, but it can&rsquo;t move your funds
          without a valid signature from you.
        </>
      ),
    },
  ];
}

export default function FaqPage() {
  const items = buildFaq();
  return (
    <div className="mx-auto" style={{ maxWidth: 760 }}>
      <header className="pp-pagetop">
        <h1 className="pp-h1">Frequently asked questions</h1>
        <p className="pp-caption">
          Quick answers about how PulsePairs works. Need more detail? Read{" "}
          <Link href="/how-it-works" className="pp-link">
            How it works
          </Link>{" "}
          or{" "}
          <Link href="/contact" className="pp-link">
            get in touch
          </Link>
          .
        </p>
      </header>
      <ol className="space-y-4">
        {items.map((item, i) => (
          <li
            key={i}
            className="rounded-[var(--r-lg)] border p-5"
            style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
          >
            <h2 className="pp-h3" style={{ marginBottom: 8 }}>
              {item.q}
            </h2>
            <div className="pp-body" style={{ color: "var(--fg-1)" }}>
              {item.a}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
