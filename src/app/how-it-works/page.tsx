import Link from "next/link";

export const metadata = { title: "How it works | PulsePairs" };

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
  return (
    <div className="mx-auto space-y-8" style={{ maxWidth: 760 }}>
      <header className="pp-pagetop">
        <h1 className="pp-h1">How PulsePairs works</h1>
        <p className="pp-caption">
          Plain-English walkthrough of the product — what a market is, how
          pricing maps to probability, how fees and resolution work, and where
          your funds live. If you’d rather skim quick answers, check the{" "}
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
          will the price be higher or lower than the opening price at the end
          of a 5-minute, 15-minute, or 1-hour window? You buy UP or DOWN
          shares with USDT. Winning shares pay $1 each at resolution; losing
          shares pay $0.
        </p>
      </Section>

      <Section id="market" title="How a market works">
        <p>
          When a market opens, we snapshot the current Chainlink BTC/USD or
          ETH/USD price as the <em>strike</em>. The market trades for the
          full window — 5 min, 15 min, or 1 hour. At the closing time, the
          oracle’s price is snapshotted again as the <em>settlement</em> price.
          If the settlement price is above strike, UP wins. Below or equal,
          DOWN wins.
        </p>
        <p>
          Three timeframes run in parallel for both BTC and ETH, so there are
          always six live markets at any given moment. As one closes, the next
          one in that series opens automatically with a fresh strike.
        </p>
      </Section>

      <Section id="pricing" title="How pricing works">
        <p>
          UP and DOWN trade on separate order books. Prices are quoted in
          cents (1¢ to 99¢). A share’s price <em>is</em> the market’s implied
          probability: if UP is trading at 60¢, the market thinks there’s a
          ~60% chance UP wins. UP and DOWN cents add up to roughly 100¢ in a
          healthy book — anything else is an arbitrage opportunity.
        </p>
        <p>
          Buying 100 shares of UP at 60¢ costs you $60 (100 × $0.60). If UP
          wins, those shares pay out $100 (100 × $1) — a $40 profit before
          fees. If UP loses, the shares pay $0 and you lose the $60 stake.
        </p>
      </Section>

      <Section id="fees" title="How fees work">
        <p>
          Fees scale with the trade’s certainty. The schedule peaks at 50¢
          (a coin-flip trade is the riskiest for the platform to facilitate)
          and tapers to nearly zero at extremes. Peak fee is{" "}
          <strong>1.5% of notional</strong> at 50¢ — at 90¢, the same trade
          pays under 0.5%. The formula is{" "}
          <code>fee = totalBps × 4 × p × (1 − p)</code>, where{" "}
          <code>p</code> is the trade’s price as a probability and{" "}
          <code>totalBps</code> = platform (0.7%) + maker (0.8%).
        </p>
        <p>
          Designated market makers (DMMs) earn a small rebate on resolved
          trades they made — see{" "}
          <Link href="/fees" className="pp-link">
            /fees
          </Link>{" "}
          for the live numbers and{" "}
          <Link href="/rebates" className="pp-link">
            /rebates
          </Link>{" "}
          if you’re a DMM.
        </p>
      </Section>

      <Section id="resolution" title="How resolution works">
        <p>
          When a market’s window closes, the resolver pulls the current
          Chainlink price for the relevant pair and compares it to the strike
          captured at open. The on-chain settlement contract credits winning
          positions $1 per share. Losing positions go to $0. The same oracle
          feed is used for both snapshots, so there’s no cross-feed
          drift to argue with.
        </p>
        <p>
          Auto-claiming happens within seconds of resolution — winnings show
          up in your wallet without any action needed. If the relayer is
          delayed, a manual <strong>Claim</strong> button appears in your
          Portfolio.
        </p>
      </Section>

      <Section id="deposit" title="How to deposit USDT">
        <p>
          PulsePairs runs on Arbitrum One. To trade, you need USDT (the
          official Arbitrum USDT contract,{" "}
          <code>0xCa4f…25F4</code>) and a small amount of ETH for the
          one-time approval transaction.
        </p>
        <p>
          Send USDT to your connected wallet — that’s it. There’s no separate
          deposit step into a custodial vault. The first BUY triggers a
          one-time <code>USDT.approve</code> transaction (paid in ETH gas)
          that grants the settlement contract permission to pull USDT at
          fill time. Every trade after that is gasless from your perspective —
          just a typed-data signature.
        </p>
      </Section>

      <Section id="claim" title="How to claim winnings">
        <p>
          Winnings are auto-claimed by the relayer when a market resolves —
          you don’t need to do anything. USDT lands in your wallet within a
          few seconds of resolution.
        </p>
        <p>
          If the relayer is rate-limited or hits a transient error, your
          Portfolio’s Resolved tab will show a <strong>Claim</strong> button
          for any unclaimed winning position. Clicking it nudges the relayer
          to retry. You’ll never lose unclaimed winnings — they sit on the
          settlement contract until claimed.
        </p>
      </Section>

      <Section id="custody" title="Where my funds live">
        <p>
          Your USDT stays in your own wallet at all times. PulsePairs uses a
          <em> signed-order model</em>: when you place a BUY, you sign an
          EIP-712 typed-data message off-chain. The matching engine pairs
          you with a counterparty, and the settlement contract pulls USDT
          directly from your wallet only at fill time, via the allowance
          you granted with the one-time approval.
        </p>
        <p>
          There is no PulsePairs-controlled wallet holding your balance,
          no deposit address you have to maintain trust in, and no
          off-platform escrow. The only on-chain movement of your USDT
          happens at trade time, with your signature as authorization.
        </p>
      </Section>
    </div>
  );
}
