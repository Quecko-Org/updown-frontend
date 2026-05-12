/**
 * Placeholder for legal pages whose final copy is still in legal review.
 * Renders a centered hero (`pp-pagetop`) followed by a "coming soon"
 * notice block. The container is horizontally centered with a 720px
 * column for comfortable reading width — body copy stays left-aligned
 * inside the centered column (centered paragraphs hurt readability).
 *
 * Real content replaces this component on a per-page basis once legal
 * sign-off lands.
 */
export function LegalPlaceholder({
  title,
  lastUpdated,
}: {
  title: string;
  lastUpdated: string;
}) {
  return (
    <div className="mx-auto" style={{ maxWidth: 720 }}>
      <header className="pp-pagetop">
        <h1 className="pp-h1">{title}</h1>
        <p className="pp-caption">Last updated: {lastUpdated}</p>
      </header>
      <div
        className="rounded-[var(--r-lg)] border p-5"
        style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
      >
        <p className="pp-body" style={{ color: "var(--fg-1)" }}>
          {title} content coming soon. The final document is undergoing legal
          review. Bookmark this page — it will update once the policy ships.
        </p>
      </div>
    </div>
  );
}
