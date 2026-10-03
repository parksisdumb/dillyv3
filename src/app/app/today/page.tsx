import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { dayStartISO, monthStart, weekStart } from "@/lib/format";
import { parseTeamGoal } from "@/lib/domain/team-goal";
import type { QueueRow } from "@/components/today/queue-item";
import { TodayView, type BriefLine } from "@/components/today/today-view";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const { sb, s, tenantId, today } = await ctx();
  const tz = s.tenant.timezone;
  const dayStart = dayStartISO(today, tz);
  const monthStartISO = dayStartISO(monthStart(today), tz);

  const [brief, queue, doneToday, firstToday, pointsToday, streak, tenantRow, board] = await Promise.all([
    sb.from("brief").select("id,headline,lines,seen_at").eq("tenant_id", tenantId).eq("user_id", s.userId).eq("for_date", today).maybeSingle(),
    sb.rpc("rep_queue", { p_tenant: tenantId, p_user: s.userId }),
    sb
      .from("task")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("assignee_user_id", s.userId)
      .eq("status", "done")
      .gte("completed_at", dayStart),
    sb
      .from("touch")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("user_id", s.userId)
      .eq("is_first_touch", true)
      .is("voided_at", null)
      .gte("occurred_at", dayStart),
    sb.from("point_event").select("points").eq("tenant_id", tenantId).eq("user_id", s.userId).eq("voided", false).gte("occurred_at", dayStart),
    sb.rpc("rep_streak", { p_tenant: tenantId, p_user: s.userId }),
    sb.from("tenant").select("settings").eq("id", tenantId).single(),
    sb.rpc("leaderboard", { p_tenant: tenantId, p_since: weekStart(today) }),
  ]);

  const goal = parseTeamGoal(tenantRow.data?.settings);
  const goalCount = goal
    ? (
        await sb
          .from("point_event")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("event", goal.event)
          .eq("voided", false)
          .gte("occurred_at", monthStartISO)
      ).count ?? 0
    : 0;

  if (brief.data && !brief.data.seen_at) {
    await sb.from("brief").update({ seen_at: new Date().toISOString() }).eq("id", brief.data.id);
  }

  const items = (queue.data ?? []) as QueueRow[];
  const taskIds = items.map((i) => i.task_id).filter((x): x is string => !!x);
  const { data: snoozes } = taskIds.length
    ? await sb.from("task").select("id,snooze_count").in("id", taskIds)
    : { data: [] as { id: string; snooze_count: number }[] };

  return (
    <TodayView
      d={{
        error: queue.error?.message ?? null,
        brief: brief.data
          ? { headline: brief.data.headline, lines: Array.isArray(brief.data.lines) ? (brief.data.lines as BriefLine[]) : [] }
          : null,
        items,
        snoozes: Object.fromEntries((snoozes ?? []).map((t) => [t.id, t.snooze_count])),
        cleared: (doneToday.count ?? 0) + (firstToday.count ?? 0),
        pointsToday: (pointsToday.data ?? []).reduce((n, p) => n + p.points, 0),
        streak: streak.data ?? 0,
        goal: goal ? { label: goal.label, target: goal.target, count: goalCount } : null,
        leaders: board.data ?? [],
        meId: s.userId,
      }}
    />
  );
}
