import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { safe, safeCount } from "@/lib/server/safe";
import { loadCold, loadDataHealth, loadPace, loadStalled } from "@/lib/server/team";
import { TeamHomeView } from "@/components/team/team-home-view";
import { loadScorecard } from "@/lib/server/scorecard";
import { loadWorking } from "@/lib/server/working";

export const metadata: Metadata = { title: "Team" };

async function TeamHomeBody() {
  const c = await ctx();
  requireManager(c.s);
  // Each card loads on its own: one slow or failing query empties that card, not the page.
  const f = { tenant: c.tenantId, user: c.s.userId };
  const [pace, cold, stalled, health, pending, scorecard, working] = await Promise.all([
    safe(() => loadPace(c), [], "team:pace", f),
    safe(() => loadCold(c, 50), [], "team:cold", f),
    safe(() => loadStalled(c), [], "team:stalled", f),
    safe(() => loadDataHealth(c), { duplicateGroups: [], propertiesTotal: 0, propertiesIncomplete: 0, completePct: 100, incompleteList: [] }, "team:data-health", f),
    safeCount(c.sb.from("approval").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId).eq("status", "pending"), "team:pending", 0, f),
    safe(() => loadScorecard(c), null, "team:scorecard", f),
    safe(() => loadWorking(c), [], "team:working", f),
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
        working: working.map((r) => ({ user_id: r.user_id, name: r.name, active: r.active, stale: r.stale })),
      }}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default function TeamHome() {
  return pageBody(() => TeamHomeBody());
}
