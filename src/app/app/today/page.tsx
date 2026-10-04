import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { safe, safeCount, safeData } from "@/lib/server/safe";
import { log } from "@/lib/observability/log";
import { requestInfo } from "@/lib/observability/request";
import { dayStartISO, monthStart, weekStart } from "@/lib/format";
import { parseTeamGoal } from "@/lib/domain/team-goal";
import type { QueueRow } from "@/components/today/queue-item";
import { TodayView, type BriefLine } from "@/components/today/today-view";
import { loadPropertyBadges } from "@/lib/server/ownership";
import { ConnectEmailPrompt } from "@/components/today/connect-email-prompt";
import { InstallHint } from "@/components/pwa/install-hint";
import { ensureOutcomeTasks, loadMyAppointments } from "@/lib/server/appointments";

export const metadata: Metadata = { title: "Today" };


/** Brief lines are agent-written JSON: keep only well-formed { kind?, text } objects so a bad row can't crash the card. */
function briefLines(raw: unknown): BriefLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is BriefLine => !!l && typeof l === "object" && typeof (l as BriefLine).text === "string");
}

async function TodayPageBody() {
  const c = await ctx();
  const { sb, s, tenantId, today } = c;
  const tz = s.tenant.timezone;
  const dayStart = dayStartISO(today, tz);
  const monthStartISO = dayStartISO(monthStart(today), tz);
  const f = { tenant: tenantId, user: s.userId };

  // Yesterday's appointments with no outcome become "Log outcome" tasks before the queue is read (idempotent).
  await safe(() => ensureOutcomeTasks(c), 0, "today:outcome-tasks", f);
  // The queue is the page; everything else is a card that degrades to empty on its own.
  const [appointments, brief, queue, doneToday, firstToday, pointsToday, streak, settings, board] = await Promise.all([
    safe(() => loadMyAppointments(c), { today: [], upcoming: [], overdue: [] }, "today:appointments", f),
    safeData(
      sb.from("brief").select("id,headline,lines,seen_at").eq("tenant_id", tenantId).eq("user_id", s.userId).eq("for_date", today).maybeSingle(),
      null,
      "today:brief",
      f,
    ),
    sb.rpc("rep_queue", { p_tenant: tenantId, p_user: s.userId }),
    safeCount(
      sb
        .from("task")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("assignee_user_id", s.userId)
        .eq("status", "done")
        .gte("completed_at", dayStart),
      "today:done-count",
      0,
      f,
    ),
    safeCount(
      sb
        .from("touch")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("user_id", s.userId)
        .eq("is_first_touch", true)
        .is("voided_at", null)
        .gte("occurred_at", dayStart),
      "today:first-touch-count",
      0,
      f,
    ),
    safeData(
      sb.from("point_event").select("points").eq("tenant_id", tenantId).eq("user_id", s.userId).eq("voided", false).gte("occurred_at", dayStart),
      [] as { points: number }[],
      "today:points",
      f,
    ),
    safeData(sb.rpc("rep_streak", { p_tenant: tenantId, p_user: s.userId }), 0, "today:streak", f),
    safeData(sb.from("tenant").select("settings").eq("id", tenantId).single(), null, "today:tenant-settings", f),
    safeData(sb.rpc("leaderboard", { p_tenant: tenantId, p_since: weekStart(today) }), [], "today:leaderboard", f),
  ]);
  if (queue.error) log.error("today:rep_queue", { ...(await requestInfo()), ...f, err: queue.error });

  const goal = await safe(() => parseTeamGoal(settings?.settings), null, "today:goal-parse", f);
  const goalCount = goal
    ? await safeCount(
        sb
          .from("point_event")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("event", goal.event)
          .eq("voided", false)
          .gte("occurred_at", monthStartISO),
        "today:goal-count",
        0,
        f,
      )
    : 0;

  const items = (queue.data ?? []) as QueueRow[];
  const taskIds = items.map((i) => i.task_id).filter((x): x is string => !!x);
  const [snoozes, , badges] = await Promise.all([
    taskIds.length
      ? safeData(sb.from("task").select("id,snooze_count,appointment_id").in("id", taskIds), [] as { id: string; snooze_count: number; appointment_id: string | null }[], "today:snoozes", f)
      : Promise.resolve([] as { id: string; snooze_count: number; appointment_id: string | null }[]),
    // Marking the brief seen is bookkeeping: it runs alongside, and a failure never blocks the page.
    brief && !brief.seen_at
      ? safeData(sb.from("brief").update({ seen_at: new Date().toISOString() }).eq("id", brief.id), null, "today:brief-seen", f)
      : Promise.resolve(null),
    safe(() => loadPropertyBadges(c, items.map((i) => i.property_id)), {}, "today:badges", f),
  ]);

  return (
    <TodayView
      d={{
        error: queue.error ? "Couldn't load your queue. Pull to refresh or try again in a minute." : null,
        brief: brief ? { headline: brief.headline, lines: briefLines(brief.lines) } : null,
        items,
        snoozes: Object.fromEntries(snoozes.map((t) => [t.id, t.snooze_count])),
        appointments,
        apptTasks: Object.fromEntries(snoozes.filter((t) => t.appointment_id).map((t) => [t.id, t.appointment_id!])),
        cleared: doneToday + firstToday,
        pointsToday: pointsToday.reduce((n, p) => n + (p.points ?? 0), 0),
        streak: streak ?? 0,
        goal: goal ? { label: goal.label, target: goal.target, count: goalCount } : null,
        leaders: board,
        meId: s.userId,
        badges,
      }}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default function TodayPage() {
  return pageBody(async () => {
    const [prompt, body] = await Promise.all([ConnectEmailPrompt(), TodayPageBody()]);
    return (
      <>
        <InstallHint />
        {prompt}
        {body}
      </>
    );
  });
}
