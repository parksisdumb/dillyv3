import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { buildScorecard, parseTargets, type Scorecard } from "@/lib/domain/scorecard";

const REP_ROLES = ["rep", "manager", "owner", "admin"];

export async function loadScorecard(c: Ctx): Promise<Scorecard> {
  const { sb, tenantId, today } = c;
  const [rows, members, tenant] = await Promise.all([
    sb.rpc("team_scorecard", { p_tenant: tenantId, p_weeks: 13 }),
    getMembers(c),
    sb.from("tenant").select("settings").eq("id", tenantId).single(),
  ]);
  if (rows.error) throw new Error(`team_scorecard: ${rows.error.message}`);
  const people = members.filter((m) => REP_ROLES.includes(m.role)).map((m) => ({ user_id: m.user_id, name: m.name }));
  return buildScorecard(rows.data ?? [], people, today, parseTargets(tenant.data?.settings));
}
