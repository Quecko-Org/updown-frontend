import { redirect } from "next/navigation";

/**
 * Phase2-A: /history consolidated into /portfolio?tab=resolved. This redirect
 * preserves any external link / bookmark that points at the old route.
 */
export default function HistoryRedirect() {
  redirect("/portfolio?tab=resolved");
}
