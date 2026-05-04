import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

// react-markdown components prop: maps each markdown element to a node we
// control, so headings get the pp- typography classes, links get pp-link,
// inline code gets a mono treatment, and tables / blockquotes get docs-only
// styling that lives entirely in the docs scope (no globals.css edits).
//
// Headings keep their `id` (set by rehype-slug). Anchor links inside heading
// text are added by rehype-autolink-headings — they appear after the heading
// content as a small "#" affordance.
// Helper to drop the `node` field react-markdown injects on every component
// renderer. Pulling `node` into a discarded local would trip
// @typescript-eslint/no-unused-vars under the project's lint config.
type WithNode<T> = T & { node?: unknown };
function stripNode<T extends object>(props: WithNode<T>): T {
  const { node: _ignored, ...rest } = props;
  void _ignored;
  return rest as T;
}

const components: Components = {
  h1: (props) => <h1 className="pp-h1 docs-h1" {...stripNode(props)} />,
  h2: (props) => <h2 className="pp-h2 docs-h2" {...stripNode(props)} />,
  h3: (props) => <h3 className="pp-h3 docs-h3" {...stripNode(props)} />,
  h4: (props) => <h4 className="pp-h3 docs-h4" {...stripNode(props)} />,
  p: (props) => <p className="docs-p" {...stripNode(props)} />,
  a: (props) => <a className="pp-link" {...stripNode(props)} />,
  ul: (props) => <ul className="docs-ul" {...stripNode(props)} />,
  ol: (props) => <ol className="docs-ol" {...stripNode(props)} />,
  li: (props) => <li className="docs-li" {...stripNode(props)} />,
  blockquote: (props) => (
    <blockquote className="docs-blockquote" {...stripNode(props)} />
  ),
  hr: (props) => <hr className="docs-hr" {...stripNode(props)} />,
  table: (props) => (
    <div className="docs-table-wrap">
      <table className="docs-table" {...stripNode(props)} />
    </div>
  ),
  th: (props) => <th className="docs-th" {...stripNode(props)} />,
  td: (props) => <td className="docs-td" {...stripNode(props)} />,
  // Inline code vs. code blocks: react-markdown surfaces both as <code>; the
  // `inline` prop is gone in v9 — we detect a fenced block by the presence of
  // a `language-*` class added by remark/rehype during fence parsing. No
  // language class → inline.
  code: (props) => {
    const { className, children, ...rest } = stripNode(props);
    const isBlock = typeof className === "string" && className.startsWith("language-");
    if (isBlock) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="docs-code-inline" {...rest}>
        {children}
      </code>
    );
  },
  pre: (props) => <pre className="docs-pre" {...stripNode(props)} />,
};

// Server Component renderer. ReactMarkdown is pure (no client-only hooks)
// so it runs at build/SSR time and ships the rendered HTML — no markdown
// parser bytes go to the browser.
export function DocsMarkdown({ source }: { source: string }) {
  return (
    <article className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: "append",
              properties: {
                className: "docs-anchor",
                ariaLabel: "Link to this section",
              },
              content: { type: "text", value: "#" },
            },
          ],
          rehypeHighlight,
        ]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </article>
  );
}
