import { redirect } from "next/navigation";

/**
 * Phase2-A: /positions consolidated into /portfolio?tab=active. This redirect
 * preserves any external link / bookmark that points at the old route.
 */
export default function PositionsRedirect() {
  redirect("/portfolio?tab=active");
}
