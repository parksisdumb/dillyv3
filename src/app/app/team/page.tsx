import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadCold, loadDataHealth, loadPace, loadStalled } from "@/lib/server/team";
import { TeamHomeView } from "@/components/team/team-home-view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamHome() {
  const c = await ctx();
  requireManager(c.s);
  const [pace, cold, stalled, health, pending] = await Promise.all([
    loadPace(c),
    loadCold(c, 50),
    loadStalled(c),
    loadDataHealth(c),
    c.sb.from("approval").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId).eq("status", "pending"),
  ]);

  return (
    <TeamHomeView
      d={{
        tenantName: c.s.tenant.name,
        pace,
        cold,
        stalled,
        health: { duplicates: health.duplicateGroups.length, propertiesIncomplete: health.propertiesIncomplete, completePct: health.completePct },
        pending: pending.count ?? 0,
      }}
    />
  );
}
