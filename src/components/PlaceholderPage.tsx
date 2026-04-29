/**
 * Minimal placeholder for routes whose real content lives on a separate
 * workstream (Terms, Privacy, FAQ, Contact). The footer links here so the
 * URLs don't 404; full copy will replace these pages later.
 */
export function PlaceholderPage({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-3">
      <h1 className="pp-h1">{title}</h1>
      <p className="pp-body" style={{ color: "var(--fg-1)", maxWidth: 640 }}>
        {subtitle}
      </p>
      <p className="pp-caption" style={{ color: "var(--fg-2)" }}>
        Full content coming soon.
      </p>
    </div>
  );
}
