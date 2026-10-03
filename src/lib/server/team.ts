import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { weekStart } from "@/lib/format";
import { OPEN_STAGES } from "@/lib/domain/vocab";
import { daysInStage, isStalled } from "@/lib/domain/pipeline";
import { duplicateGroups } from "@/lib/domain/dupes";

const REP_ROLES = ["rep", "manager", "owner", "admin"];

export type PaceRow = {
  user_id: string;
  name: string;
  role: string;
  touchesToday: number;
  touchesWeek: number;
  inPersonWeek: number;
  connectsWeek: number;
  pointsWeek: number;
  followUpPct: number | null;
  followUpsDue: number;
  overdue: number;
  streak: number;
};

export async function loadPace(c: Ctx): Promise<PaceRow[]> {
  const { sb, tenantId, today } = c;
  const wk = weekStart(today);
  const [members, week, day, tasks, overdue] = await Promise.all([
    getMembers(c),
    sb.rpc("leaderboard", { p_tenant: tenantId, p_since: wk }),
    sb.rpc("leaderboard", { p_tenant: tenantId, p_since: today }),
    sb.from("task").select("assignee_user_id,status").eq("tenant_id", tenantId).gte("due_on", wk).lte("due_on", today).neq("status", "dropped").limit(5000),
    sb.from("task").select("assignee_user_id").eq("tenant_id", tenantId).eq("status", "open").lt("due_on", today).limit(5000),
  ]);
  const reps = members.filter((m) => REP_ROLES.includes(m.role));
  const streaks = await Promise.all(reps.map((m) => sb.rpc("rep_streak", { p_tenant: tenantId, p_user: m.user_id })));
  const wkMap = new Map((week.data ?? []).map((r) => [r.user_id, r]));
  const dayMap = new Map((day.data ?? []).map((r) => [r.user_id, r]));

  return reps
    .map((m, i) => {
      const w = wkMap.get(m.user_id);
      const mine = (tasks.data ?? []).filter((t) => t.assignee_user_id === m.user_id);
      const done = mine.filter((t) => t.status === "done").length;
      return {
        user_id: m.user_id,
        name: m.name,
        role: m.role,
        touchesToday: Number(dayMap.get(m.user_id)?.touches ?? 0),
        touchesWeek: Number(w?.touches ?? 0),
        inPersonWeek: Number(w?.in_person ?? 0),
        connectsWeek: Number(w?.connects ?? 0),
        pointsWeek: Number(w?.points ?? 0),
        followUpPct: mine.length ? Math.round((done / mine.length) * 100) : null,
        followUpsDue: mine.length,
        overdue: (overdue.data ?? []).filter((t) => t.assignee_user_id === m.user_id).length,
        streak: streaks[i]?.data ?? 0,
      };
    })
    .sort((a, b) => b.pointsWeek - a.pointsWeek);
}

export async function loadCold(c: Ctx, limit = 200) {
  const { sb, tenantId } = c;
  const [rows, members] = await Promise.all([
    sb
      .from("account_ranked")
      .select("id,name,icp_tier,days_since_touch,last_touch_at,owner_user_id,open_opps,city,account_type")
      .eq("tenant_id", tenantId)
      .eq("relationship_state", "cold")
      .lte("icp_tier", 2)
      .eq("is_test", false)
      .order("icp_tier")
      .order("days_since_touch", { ascending: false })
      .limit(limit),
    getMembers(c),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  return (rows.data ?? []).map((r) => ({ ...r, owner: r.owner_user_id ? names.get(r.owner_user_id) ?? "—" : "Unassigned" }));
}

export async function loadStalled(c: Ctx) {
  const { sb, tenantId, today } = c;
  const [opps, members] = await Promise.all([
    sb
      .from("opportunity")
      .select("id,name,stage,value_estimate,stage_changed_at,next_step,next_step_due,owner_user_id,account_id")
      .eq("tenant_id", tenantId)
      .eq("is_test", false)
      .in("stage", OPEN_STAGES)
      .limit(1000),
    getMembers(c),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const stalled = (opps.data ?? [])
    .map((o) => ({ ...o, days: daysInStage(o.stage_changed_at, today) }))
    .filter((o) => isStalled(o.stage, o.days) || !o.next_step_due || o.next_step_due < today)
    .sort((a, b) => (b.value_estimate ?? 0) - (a.value_estimate ?? 0));
  const acctIds = [...new Set(stalled.map((o) => o.account_id).filter((x): x is string => !!x))];
  const { data: accts } = acctIds.length ? await sb.from("account").select("id,name").in("id", acctIds) : { data: [] };
  const an = new Map((accts ?? []).map((a) => [a.id, a.name]));
  return stalled.map((o) => ({
    ...o,
    owner: o.owner_user_id ? names.get(o.owner_user_id) ?? "—" : "—",
    account: o.account_id ? an.get(o.account_id) ?? null : null,
    why: isStalled(o.stage, o.days) ? `${o.days}d in stage` : !o.next_step_due ? "No next step" : "Next step overdue",
  }));
}

export async function loadDataHealth(c: Ctx) {
  const { sb, tenantId } = c;
  const [contacts, propsTotal, propsIncomplete, incompleteList] = await Promise.all([
    sb.from("contact").select("id,full_name,email,phone,mobile,account_id").eq("tenant_id", tenantId).is("duplicate_of", null).eq("is_test", false).limit(10000),
    sb.from("property").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("duplicate_of", null).eq("is_test", false),
    sb
      .from("property")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("duplicate_of", null)
      .eq("is_test", false)
      .or("roof_system.is.null,address1.is.null,roof_area_sf.is.null"),
    sb
      .from("property")
      .select("id,name,address1,city,roof_system,roof_area_sf,account_id")
      .eq("tenant_id", tenantId)
      .is("duplicate_of", null)
      .eq("is_test", false)
      .or("roof_system.is.null,address1.is.null,roof_area_sf.is.null")
      .limit(100),
  ]);
  const groups = duplicateGroups(contacts.data ?? []);
  const total = propsTotal.count ?? 0;
  const incomplete = propsIncomplete.count ?? 0;
  return {
    duplicateGroups: groups,
    propertiesTotal: total,
    propertiesIncomplete: incomplete,
    completePct: total ? Math.round(((total - incomplete) / total) * 100) : 100,
    incompleteList: incompleteList.data ?? [],
  };
}
