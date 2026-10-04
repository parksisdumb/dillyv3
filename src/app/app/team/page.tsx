import { Suspense } from "react";
import RouteSkeleton from "./skeleton";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { safe, safeCount } from "@/lib/server/safe";
import { loadCold, loadDataHealth, loadPace, loadStalled } from "@/lib/server/team";
import { TeamHomeView } from "@/components/team/team-home-view";
import { loadScorecard } from "@/lib/server/scorecard";

export const metadata: Metadata = { title: "Team" };

async function TeamHomeBody() {
  const c = await ctx();
  requireManager(c.s);
  // Each card loads on its own: one slow or failing query empties that card, not the page.
  const f = { tenant: c.tenantId, user: c.s.userId };
  const [pace, cold, stalled, health, pending, scorecard] = await Promise.all([
    safe(() => loadPace(c), [], "team:pace", f),
    safe(() => loadCold(c, 50), [], "team:cold", f),
    safe(() => loadStalled(c), [], "team:stalled", f),
    safe(() => loadDataHealth(c), { duplicateGroups: [], propertiesTotal: 0, propertiesIncomplete: 0, completePct: 100, incompleteList: [] }, "team:data-health", f),
    safeCount(c.sb.from("approval").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId).eq("status", "pending"), "team:pending", 0, f),
    safe(() => loadScorecard(c), null, "team:scorecard", f),
  ]);

  return (
    <TeamHomeView
      d={{
        tenantName: c.s.tenant.name,
        pace,
        cold,
        stalled,
        health: { duplicates: health.duplicateGroups.length, propertiesIncomplete: health.propertiesIncomplete, completePct: health.completePct },
        pending,
        scorecard,
      }}
    />
  );
}

// Skeleton in the page's own Suspense, not a route loading.tsx (see tests/e2e/BUGS.md B9).
export default function TeamHome() {
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <TeamHomeBody />
    </Suspense>
  );
}
