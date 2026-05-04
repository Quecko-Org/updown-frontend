import Link from "next/link";
import { DocsSidebar } from "@/components/DocsSidebar";

// highlight.js dark theme — github-dark for syntax-highlighted code blocks
// inside the rendered markdown. Imported once at the layout level so every
// section page (api / sdk) shares the same theme.
import "highlight.js/styles/github-dark.css";
// Route-scoped stylesheet — only loaded on /docs/*. Keeps globals.css /
// design-tokens.css / pp-utilities.css untouched per the public-docs spec.
import "./docs.css";

export const metadata = {
  title: "Docs | PulsePairs",
  description:
    "PulsePairs API + SDK reference. HTTP endpoints, EIP-712 order signing, WebSocket auth handshake, settlement / resolution flows, and the TypeScript SDK quickstart.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto" style={{ maxWidth: 1200 }}>
      <header className="pp-pagetop">
        <h1 className="pp-h1">Docs</h1>
        <p className="pp-caption">
          API + SDK reference for integrators. The canonical wire-shape doc and
          TypeScript quickstart, mirrored from the backend repo. For a
          plain-English walkthrough of the product, see{" "}
          <Link href="/how-it-works" className="pp-link">
            How it works
          </Link>
          .
        </p>
      </header>

      <div className="docs-shell">
        <aside className="docs-sidebar">
          <DocsSidebar />
        </aside>
        <div className="docs-content">{children}</div>
      </div>
    </div>
  );
}
