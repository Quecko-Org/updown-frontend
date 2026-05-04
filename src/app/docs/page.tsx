import { redirect } from "next/navigation";

// Default tab — /docs lands on the API reference. Both /docs and /docs/api
// resolve to the same content; redirect keeps a single canonical URL.
export default function DocsIndexPage() {
  redirect("/docs/api");
}
