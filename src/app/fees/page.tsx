import Link from "next/link";

export default function FeesPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Fees</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          PulsePairs charges a transparent fee stack on matched volume. Exact basis points are loaded from protocol
          configuration at runtime; the targets below are the live product defaults.
        </p>
      </div>

      <section className="card-kraken space-y-4 p-6">
        <h2 className="font-display text-xl font-bold text-foreground">Trading fees</h2>
        <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-muted">
          <li>
            <span className="font-semibold text-foreground">0.7% platform fee</span> — supports matching,
            settlement, and infrastructure.
          </li>
          <li>
            <span className="font-semibold text-foreground">0.8% maker fee</span> — paid on liquidity that rests on
            the book and gets filled.
          </li>
          <li>
            Together that is <span className="font-semibold text-foreground">1.5% total</span> on the configured fee
            leg (see live values on the trade panel from{" "}
            <code className="rounded bg-surface-muted px-1 font-mono text-xs">GET /config</code>).
          </li>
        </ul>
      </section>

      <section className="card-kraken space-y-4 p-6">
        <h2 className="font-display text-xl font-bold text-foreground">Designated market makers (DMM)</h2>
        <p className="text-sm leading-relaxed text-muted">
          Market makers who meet program requirements can earn <span className="font-semibold text-foreground">rebates</span>{" "}
          on filled maker volume. Rebates are configured in basis points and shown in the trade form when your wallet is
          approved for the program.
        </p>
        <p className="text-sm leading-relaxed text-muted">
          Requirements typically include quoting both sides of the book within spread and size guidelines, uptime, and
          fair pricing. To apply, contact the team through your usual operations channel; approval is reflected in{" "}
          <code className="rounded bg-surface-muted px-1 font-mono text-xs">GET /dmm/status/:wallet</code>.
        </p>
        <p className="text-sm">
          <Link href="/rebates" className="font-semibold text-brand hover:underline">
            Rebates dashboard →
          </Link>{" "}
          <span className="text-muted">(visible in the nav when your wallet is connected as a DMM.)</span>
        </p>
      </section>

      <section className="card-kraken space-y-4 p-6">
        <h2 className="font-display text-xl font-bold text-foreground">Order types</h2>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="font-semibold text-foreground">LIMIT</dt>
            <dd className="mt-1 text-muted">
              Rests on the book at your price (basis points). Fills when the market reaches your level.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">MARKET</dt>
            <dd className="mt-1 text-muted">
              No limit price in the form; matches against the best available liquidity on the book immediately.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">POST_ONLY</dt>
            <dd className="mt-1 text-muted">
              Maker-only: your order is only accepted if it would rest on the book. If it would cross and fill
              immediately, it is rejected.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">IOC (Immediate or cancel)</dt>
            <dd className="mt-1 text-muted">
              Fills whatever size is available at your limit right now; any unfilled remainder is canceled.
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-sm text-muted">
        <Link href="/" className="font-semibold text-brand hover:underline">
          ← Back to markets
        </Link>
      </p>
    </div>
  );
}
