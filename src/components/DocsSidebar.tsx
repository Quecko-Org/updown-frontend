"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { href: "/docs/api", label: "API Reference" },
  { href: "/docs/sdk", label: "TypeScript SDK" },
] as const;

// Sidebar nav for the /docs route. Active highlight tracks pathname so the
// current section is visually pinned. On mobile (<md) the `docs-shell` flips
// the layout to stack, and the same list renders as a horizontal scroll of
// pills above the content (CSS-only via media query in DocsMarkdown.module.css).
export function DocsSidebar() {
  const pathname = usePathname() ?? "";
  // Treat /docs (which redirects to /docs/api) as api too, so the highlight
  // doesn't briefly disappear during the redirect handoff.
  const activeHref =
    pathname === "/docs" ? "/docs/api" : pathname;

  return (
    <nav className="docs-sidenav" aria-label="Docs sections">
      {SECTIONS.map((s) => {
        const on = activeHref === s.href || activeHref.startsWith(s.href + "/");
        return (
          <Link
            key={s.href}
            href={s.href}
            className={cn("docs-sidenav__item", on && "docs-sidenav__item--on")}
            aria-current={on ? "page" : undefined}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
