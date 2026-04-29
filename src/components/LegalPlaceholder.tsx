/**
 * Placeholder for legal pages whose final copy is still in legal review.
 * Renders a clear "coming soon" notice with a `Last updated` stamp so users
 * (and reviewers) can see freshness at a glance. Real content replaces this
 * component on a per-page basis once legal sign-off lands.
 */
export function LegalPlaceholder({
  title,
  lastUpdated,
}: {
  title: string;
  lastUpdated: string;
}) {
  return (
    <div className="space-y-4" style={{ maxWidth: 720 }}>
      <h1 className="pp-h1">{title}</h1>
      <p className="pp-caption" style={{ color: "var(--fg-2)" }}>
        Last updated: {lastUpdated}
      </p>
      <div
        className="rounded-[6px] border p-4"
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
