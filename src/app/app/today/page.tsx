import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { dayStartISO, monthStart, weekStart } from "@/lib/format";
import { parseTeamGoal } from "@/lib/domain/team-goal";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Bar, ErrorNote, SectionTitle, Stat } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { QueueItem, type QueueRow } from "@/components/today/queue-item";
import { IconGo, IconStreak } from "@/components/icons";

export const metadata: Metadata = { title: "Today" };

type BriefLine = { kind?: string; text?: string };

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
  const snoozeMap = new Map((snoozes ?? []).map((t) => [t.id, t.snooze_count]));

  const overdue = items.filter((i) => i.item_type === "task" && (i.overdue_days ?? 0) > 0);
  const dueToday = items.filter((i) => i.item_type === "task" && (i.overdue_days ?? 0) === 0);
  const reengage = items.filter((i) => i.item_type === "reengage");
  const firsts = items.filter((i) => i.item_type === "first_touch");

  const cleared = (doneToday.count ?? 0) + (firstToday.count ?? 0);
  const total = cleared + items.length;
  const pts = (pointsToday.data ?? []).reduce((n, p) => n + p.points, 0);
  const lines = (Array.isArray(brief.data?.lines) ? (brief.data.lines as BriefLine[]) : []).filter((l) => l?.text).slice(0, 3);
  const leaders = (board.data ?? []).slice(0, 5);
  const meRank = (board.data ?? []).findIndex((r) => r.user_id === s.userId);

  const groups: { key: string; title: string; rows: QueueRow[]; tone?: string }[] = [
    { key: "overdue", title: `Overdue · ${overdue.length}`, rows: overdue, tone: "text-danger" },
    { key: "today", title: `Due today · ${dueToday.length}`, rows: dueToday },
    { key: "reengage", title: `Re-engage · ${reengage.length}`, rows: reengage },
    { key: "first", title: `First touches · ${firsts.length}`, rows: firsts },
  ];

  return (
    <div>
      {queue.error && <ErrorNote>Couldn&apos;t load your queue: {queue.error.message}</ErrorNote>}

      {/* Brief */}
      {brief.data && (
        <section className="mx-4 mt-4 rounded-lg border-l-4 border-accent bg-surface px-4 py-3" aria-label="Daily brief">
          <div className="label text-xs text-muted">Daily brief</div>
          <p className="mt-1 font-display text-xl font-bold leading-snug">{brief.data.headline}</p>
          {lines.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-base">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="label mt-0.5 w-12 shrink-0 text-xs text-muted">{l.kind === "one_thing" ? "Focus" : l.kind === "due" ? "Due" : l.kind === "new" ? "New" : ""}</span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Progress */}
      <section className="flex items-center gap-5 px-4 pt-5" aria-label="Today's progress">
        <ProgressRing done={cleared} total={total} />
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Points today" value={`+${pts}`} />
          <Stat
            label="Streak"
            value={
              <span className="inline-flex items-center gap-1">
                <IconStreak size={22} className={cn((streak.data ?? 0) > 0 ? "text-accent" : "text-muted")} />
                {streak.data ?? 0}
              </span>
            }
            sub="cleared weekdays"
          />
          {goal && (
            <div className="col-span-2">
              <div className="flex items-baseline justify-between">
                <span className="label text-xs text-muted">Team · {goal.label}</span>
                <span className="num text-sm font-semibold">
                  {goalCount}/{goal.target}
                </span>
              </div>
              <div className="mt-1">
                <Bar value={goalCount} max={goal.target} tone={goalCount >= goal.target ? "success" : "accent"} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Queue */}
      {items.length === 0 ? (
        <section className="mx-4 mt-6 rounded-lg border-2 border-dashed border-line px-4 py-8 text-center">
          <p className="font-display text-2xl font-bold">Queue clear — go build the book</p>
          <p className="mt-1 text-sm text-muted">Nothing due. Knock on doors, add the people you meet.</p>
          <Link href="/app/go" className={btn("primary", "lg", "mt-4")}>
            <IconGo size={22} /> Start a field session
          </Link>
        </section>
      ) : (
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <section key={g.key} aria-label={g.title}>
              <SectionTitle>
                <span className={g.tone}>{g.title}</span>
              </SectionTitle>
              <ul className="divide-y divide-line border-y border-line bg-surface">
                {g.rows.map((it, i) => (
                  <QueueItem key={`${it.item_type}-${it.task_id ?? it.account_id}-${i}`} item={it} snoozeCount={it.task_id ? snoozeMap.get(it.task_id) ?? 0 : 0} />
                ))}
              </ul>
            </section>
          ))
      )}

      {/* Leaderboard */}
      {leaders.length > 0 && (
        <section aria-label="Leaderboard this week">
          <SectionTitle action={meRank >= 5 ? <span className="num text-sm text-muted">You: #{meRank + 1}</span> : undefined}>This week</SectionTitle>
          <ol className="divide-y divide-line border-y border-line bg-surface">
            {leaders.map((r, i) => (
              <li key={r.user_id ?? i} className={cn("flex min-h-12 items-center gap-3 px-4", r.user_id === s.userId && "bg-accent/8")}>
                <span className="num w-6 font-display font-bold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.full_name ?? "Teammate"}</span>
                <span className="num text-sm text-muted">{r.touches ?? 0} touches</span>
                <span className="num w-14 text-right font-display font-bold">{r.points ?? 0}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
