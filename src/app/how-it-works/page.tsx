"use client";

import Link from "next/link";
import { activeChain, tokenSymbolForActiveChain } from "@/config/environment";

/**
 * PR-5: full Phase-4 rewrite. Earlier copy described Path-1 EOA-direct
 * architecture (USDT in your wallet, you sign EIP-712 orders, settlement
 * pulls from your wallet via approve allowance). Under Phase 4 the
 * trading account is a per-user ThinWallet smart contract; USDTM/USDT
 * lives on it, ERC-1271 signature verification routes through it, and
 * meta-tx execution via the relayer means zero gas on the user side.
 *
 * Chain-aware copy via `activeChain.name` + `tokenSymbolForActiveChain()`.
 */

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="pp-h2">{title}</h2>
      <div className="pp-body" style={{ color: "var(--fg-1)" }}>
        {children}
      </div>
    </section>
  );
}

export default function HowItWorksPage() {
  const chain = activeChain.name;
  const tokenSym = tokenSymbolForActiveChain();
  const nativeSym = activeChain.nativeCurrency.symbol;

  return (
    <div className="mx-auto space-y-8" style={{ maxWidth: 760 }}>
      <header className="pp-pagetop">
        <h1 className="pp-h1">How PulsePairs works</h1>
        <p className="pp-caption">
          Plain-English walkthrough — what a market is, how pricing maps to
          probability, how your trading account is set up, where funds live,
          and how fees + resolution work. If you&rsquo;d rather skim quick
          answers, check the{" "}
          <Link href="/faq" className="pp-link">
            FAQ
          </Link>
          .
        </p>
      </header>

      <Section id="what" title="What is PulsePairs?">
        <p>
          PulsePairs is a binary-outcome prediction market for short-window
          BTC/USD and ETH/USD price moves. Each market asks one question:
          will the price be higher or lower than the opening price at the
          end of a 5-minute, 15-minute, or 1-hour window? You buy UP or
          DOWN shares with {tokenSym}. Winning shares pay $1 each at
          resolution; losing shares pay $0.
        </p>
      </Section>

      <Section id="market" title="How a market works">
        <p>
          When a market opens, we snapshot the current Chainlink BTC/USD
          or ETH/USD price as the <em>strike</em>. The market trades for
          the full window — 5 min, 15 min, or 1 hour. At the closing
          time, the oracle&rsquo;s price is snapshotted again as the{" "}
          <em>settlement</em>. If settlement is above strike, UP wins.
          Below or equal, DOWN wins.
        </p>
        <p>
          Three timeframes run in parallel for both BTC and ETH, so there
          are always six live markets at any given moment. As one closes,
          the next in that series opens automatically with a fresh strike.
        </p>
      </Section>

      <Section id="pricing" title="How pricing works">
        <p>
          UP and DOWN trade on separate order books. Prices are quoted in
          cents (1¢ to 99¢). A share&rsquo;s price <em>is</em> the
          market&rsquo;s implied probability: if UP is trading at 60¢, the
          market thinks there&rsquo;s a ~60% chance UP wins. UP and DOWN
          cents add up to roughly 100¢ in a healthy book — anything else
          is an arbitrage opportunity.
        </p>
        <p>
          Buying 100 shares of UP at 60¢ costs you $60 (100 × $0.60). If
          UP wins, those shares pay out $100 (100 × $1) — a $40 profit
          before fees. If UP loses, the shares pay $0 and you lose the
          $60 stake.
        </p>
      </Section>

      <Section id="account" title="Your trading account is a smart account">
        <p>
          Your trading account is a per-user smart contract called a{" "}
          <strong>ThinWallet</strong>. It&rsquo;s deployed automatically at
          first connect, at a deterministic address derived from your
          wallet (CREATE2). Your wallet — MetaMask, Coinbase, WalletConnect —
          is set as the contract&rsquo;s <code>owner</code>, and is the only
          address whose signatures the contract honors.
        </p>
        <p>
          The ThinWallet holds your {tokenSym} balance, is the on-chain
          counterparty in every settlement, and is the address that
          appears as <code>order.maker</code> on every signed order. When
          the matching engine pairs you with a counterparty, the
          settlement contract pulls {tokenSym} directly from your
          ThinWallet — not from your connected wallet. Your wallet&rsquo;s
          job is to sign authorization envelopes; the funds and the
          on-chain identity live on the ThinWallet you own.
        </p>
        <p>
          This isn&rsquo;t custody. The ThinWallet is your contract — only
          your wallet&rsquo;s signatures can authorize moves. The relayer is
          the broadcaster (pays {nativeSym} gas, ferries signatures to the
          chain) but can&rsquo;t move funds without a valid signature from
          you. Verified on-chain via ERC-1271.
        </p>
      </Section>

      <Section id="onboarding" title="Onboarding — two signatures, zero gas">
        <p>
          Setup is two one-time signatures, both gasless from your wallet&rsquo;s
          perspective:
        </p>
        <ol className="ml-5 list-decimal space-y-2">
          <li>
            <strong>Identity sign</strong> — a <code>personal_sign</code> over
            your wallet address. Used to deploy your ThinWallet at the
            deterministic address derived from your wallet, and to identify
            you in subsequent API calls.
          </li>
          <li>
            <strong>Approve sign</strong> — an EIP-712 envelope authorizing
            the settlement contract to pull {tokenSym} from your ThinWallet
            at fill time. The relayer broadcasts the on-chain{" "}
            <code>approve</code> call. One-time per chain.
          </li>
        </ol>
        <p>
          Both signatures are typed-data popups in your wallet — no on-chain
          transactions on your side, no {nativeSym} required. From there
          forward, every trade is just an order signature. The relayer pays
          {" "}{nativeSym} gas for everything: setup, trade settlement,
          withdraw.
        </p>
      </Section>

      <Section id="fees" title="How fees work">
        <p>
          Fees scale with the trade&rsquo;s certainty. The schedule peaks at
          50¢ (a coin-flip trade is the riskiest for the platform to
          facilitate) and tapers to nearly zero at extremes. Peak fee is{" "}
          <strong>1.5% of notional</strong> at 50¢ — at 90¢, the same trade
          pays under 0.5%. The formula:
        </p>
        <p>
          <code>fee = totalBps × 4 × p × (1 − p)</code>
        </p>
        <p>
          where <code>p</code> is the trade&rsquo;s price as a probability
          (0–1) and <code>totalBps</code> = platform (0.7%) + maker (0.8%).
          Designated Market Makers (DMMs) earn a small bonus rebate on top
          of the maker fee for resolved trades they participated in. See{" "}
          <Link href="/fees" className="pp-link">
            /fees
          </Link>{" "}
          for the live numbers and{" "}
          <Link href="/rebates" className="pp-link">
            /rebates
          </Link>{" "}
          if you&rsquo;re a DMM.
        </p>
      </Section>

      <Section id="resolution" title="How resolution works">
        <p>
          When a market&rsquo;s window closes, the resolver pulls the
          current Chainlink price for the relevant pair and compares it
          to the strike captured at open. The on-chain settlement contract
          credits winning positions $1 per share into your ThinWallet&rsquo;s{" "}
          {tokenSym} balance. Losing positions go to $0. Same oracle feed
          on both snapshots — no cross-feed drift to argue with.
        </p>
        <p>
          Auto-claiming happens within seconds of resolution — winnings
          show up in your trading account balance with no action required.
          If the relayer is delayed, a manual <strong>Claim</strong> button
          appears in your Portfolio.
        </p>
      </Section>

      <Section id="deposit" title="Depositing">
        <p>
          To trade you need {tokenSym} on {chain} in your{" "}
          <strong>trading account</strong> (your ThinWallet), not your
          connected wallet. Open the Deposit modal from the wallet chip in
          the header — it shows your ThinWallet address and a QR. Send{" "}
          {tokenSym} to it from any source: a CEX withdrawal, a friend, a
          bridge, another wallet.
        </p>
        <p>
          You do <em>not</em> need {nativeSym} for gas. You do not need
          {" "}{tokenSym} in your connected wallet — the connected wallet&rsquo;s
          job is to sign, not to hold funds.
        </p>
      </Section>

      <Section id="claim" title="Claiming winnings">
        <p>
          Winnings are auto-credited into your trading account by the
          relayer when a market resolves — typically within a few seconds.
          You don&rsquo;t need to do anything.
        </p>
        <p>
          If the relayer is rate-limited or hits a transient error, your
          Portfolio&rsquo;s Resolved tab will show a <strong>Claim</strong>{" "}
          button for any unclaimed winning position. Clicking it nudges
          the relayer to retry. You&rsquo;ll never lose unclaimed winnings —
          they sit on the settlement contract until claimed.
        </p>
      </Section>

      <Section id="custody" title="Where your funds live">
        <p>
          Your {tokenSym} lives on <em>your</em> ThinWallet smart contract.
          You own that contract — your wallet is its{" "}
          <code>owner</code>, set at deployment and not changeable. Every
          on-chain move ({tokenSym} transfer, withdraw, trade settlement)
          requires your wallet&rsquo;s signature, verified at the contract
          level via ERC-1271.
        </p>
        <p>
          There is no PulsePairs-controlled wallet that holds your funds.
          There is no off-platform escrow. The relayer broadcasts on-chain
          actions on your behalf — it pays {nativeSym} gas and queues your
          signed envelopes to the chain — but it can&rsquo;t spend your{" "}
          {tokenSym} without a valid signature. To withdraw, sign the
          Withdraw modal&rsquo;s typed-data envelope; the relayer broadcasts
          a {tokenSym}<code>.transfer</code> from your ThinWallet to your
          chosen destination.
        </p>
      </Section>
    </div>
  );
}
