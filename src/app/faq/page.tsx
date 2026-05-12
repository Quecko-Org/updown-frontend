import Link from "next/link";

export const metadata = { title: "FAQ | PulsePairs" };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do PulsePairs markets work?",
    a: (
      <>
        Each market is a fixed-window prediction on whether BTC or ETH will
        close above (“UP”) or below (“DOWN”) its opening price within
        5 minutes, 15 minutes, or 1 hour. The opening price (“strike”) is
        snapshotted from the Chainlink BTC/USD or ETH/USD oracle when the
        market opens. Buy UP shares if you think the price will be higher at
        the closing snapshot, DOWN shares if you think it will be lower.
        Winning shares pay $1 each at resolution; losing shares pay $0.
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
        extremes. Two components: a 0.7% platform fee and a 0.8% maker fee,
        both scaled by the probability weight (4·p·(1−p)). Designated market
        makers (DMMs) earn a small rebate on resolved trades. See{" "}
        <Link href="/fees" className="pp-link">
          /fees
        </Link>{" "}
        for the full schedule.
      </>
    ),
  },
  {
    q: "How do I deposit / withdraw?",
    a: (
      <>
        Send USDT (the <code>0xCa4f…25F4</code> token on Arbitrum One) to your
        connected wallet — that’s your trading balance. There’s no separate
        deposit step into a custodial vault: PulsePairs is non-custodial, your
        USDT stays in your wallet. The first BUY triggers a one-time
        approval (paid in ETH gas) granting the settlement contract permission
        to pull funds at trade time. Withdrawing means moving USDT out of your
        wallet to wherever you want.
      </>
    ),
  },
  {
    q: "What happens if I win or lose?",
    a: (
      <>
        When the market resolves, the relayer automatically credits winning
        positions ($1 per winning share, minus fees and any partial fills).
        Losing positions go to $0. Auto-claiming usually completes within a
        few seconds. If the relayer is delayed, a manual <strong>Claim</strong>{" "}
        button appears in your Portfolio so you can nudge the credit yourself.
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
            <strong>Insufficient USDT balance</strong> — the wallet doesn’t
            have enough USDT for the stake.
          </li>
          <li>
            <strong>Market not active</strong> — the countdown crossed 0:00
            mid-flight; pick the next live market.
          </li>
          <li>
            <strong>POST-only would have filled immediately</strong> — your
            POST-only price crossed the order book; pick a price further from
            the book.
          </li>
          <li>
            <strong>Wallet declined</strong> — the EIP-712 signature was
            rejected in your wallet popup.
          </li>
          <li>
            <strong>Network hiccup</strong> — RPC or signer transient error;
            retry once.
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
        a UP price of 60¢ means the market collectively thinks there’s a
        ~60% chance of an UP outcome at resolution. UP and DOWN cents sum to
        roughly 100¢ in a healthy book.
      </>
    ),
  },
  {
    q: "What chain is this on?",
    a: (
      <>
        Arbitrum One (<code>chainId 42161</code>). All trading, settlement,
        and USDT custody happen on Arbitrum. Make sure your wallet is
        connected to Arbitrum One before placing orders.
      </>
    ),
  },
  {
    q: "What's the smallest trade size?",
    a: (
      <>
        Minimum stake is <strong>$5 USDT</strong>. Maximum is{" "}
        <strong>$500 USDT</strong> per order. Bigger positions are achievable
        by stacking multiple orders.
      </>
    ),
  },
  {
    q: "Are my funds custodial?",
    a: (
      <>
        No. PulsePairs uses a signed-order model — your USDT lives in your
        own wallet at all times. When you place a BUY, you sign an EIP-712
        order off-chain; the matching engine pairs you with a counterparty,
        and the settlement contract pulls USDT directly from your wallet
        only at fill time. We never hold your funds.
      </>
    ),
  },
];

export default function FaqPage() {
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
        {FAQ.map((item, i) => (
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
