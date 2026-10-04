import Link from "next/link";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Bar, ErrorNote, SectionTitle, Stat } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { QueueItem, type QueueRow } from "@/components/today/queue-item";
import { IconGo, IconStreak } from "@/components/icons";
import type { PropertyBadge } from "@/lib/domain/badges-property";

export type BriefLine = { kind?: string; text?: string };

export type TodayData = {
  error?: string | null;
  brief: { headline: string; lines: BriefLine[] } | null;
  items: QueueRow[];
  snoozes: Record<string, number>;
  cleared: number;
  pointsToday: number;
  streak: number;
  goal: { label: string; target: number; count: number } | null;
  leaders: { user_id: string | null; full_name: string | null; touches: number | null; points: number | null }[];
  meId: string;
  /** Badges by property id, for queue items that reference a building. */
  badges?: Record<string, PropertyBadge[]>;
};

const BRIEF_KIND: Record<string, string> = { one_thing: "Focus", due: "Due", new: "New" };

export function TodayView({ d }: { d: TodayData }) {
  const items = d.items;
  const overdue = items.filter((i) => i.item_type === "task" && (i.overdue_days ?? 0) > 0);
  const dueToday = items.filter((i) => i.item_type === "task" && (i.overdue_days ?? 0) === 0);
  const reengage = items.filter((i) => i.item_type === "reengage");
  const firsts = items.filter((i) => i.item_type === "first_touch");
  const total = d.cleared + items.length;
  const lines = d.brief?.lines.filter((l) => l?.text).slice(0, 3) ?? [];
  const leaders = d.leaders.slice(0, 5);
  const meRank = d.leaders.findIndex((r) => r.user_id === d.meId);

  const groups: { key: string; title: string; rows: QueueRow[]; tone?: string }[] = [
    { key: "overdue", title: `Overdue · ${overdue.length}`, rows: overdue, tone: "text-danger" },
    { key: "today", title: `Due today · ${dueToday.length}`, rows: dueToday },
    { key: "reengage", title: `Re-engage · ${reengage.length}`, rows: reengage },
    { key: "first", title: `First touches · ${firsts.length}`, rows: firsts },
  ];

  return (
    <div>
      {d.error && <ErrorNote>Couldn&apos;t load your queue: {d.error}</ErrorNote>}

      {d.brief && (
        <section className="mx-4 mt-4 rounded-lg border-l-4 border-accent bg-surface px-4 py-3" aria-label="Daily brief">
          <div className="label text-xs text-muted">Daily brief</div>
          <p className="mt-1 font-display text-xl font-bold leading-snug">{d.brief.headline}</p>
          {lines.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5 text-base">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="label mt-1 w-12 shrink-0 text-xs text-muted">{BRIEF_KIND[l.kind ?? ""] ?? ""}</span>
                  <span className="min-w-0">{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex items-center gap-5 px-4 pt-5" aria-label="Today's progress">
        <ProgressRing done={d.cleared} total={total} />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Points today" value={`+${d.pointsToday}`} />
          <Stat
            label="Streak"
            value={
              <span className="inline-flex items-center gap-1">
                <IconStreak size={22} className={cn(d.streak > 0 ? "text-accent" : "text-muted")} />
                {d.streak}
              </span>
            }
            sub="cleared weekdays"
          />
        </div>
      </section>
      {d.goal && (
        <section className="px-4 pt-4" aria-label="Team goal">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label text-xs text-muted">Team goal · {d.goal.label}</span>
            <span className="num shrink-0 text-sm font-semibold">
              {d.goal.count}/{d.goal.target}
            </span>
          </div>
          <div className="mt-1.5">
            <Bar value={d.goal.count} max={d.goal.target} tone={d.goal.count >= d.goal.target ? "success" : "accent"} />
          </div>
        </section>
      )}

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
                  <QueueItem key={`${it.item_type}-${it.task_id ?? it.account_id}-${i}`} item={it} snoozeCount={it.task_id ? d.snoozes[it.task_id] ?? 0 : 0} badges={it.property_id ? d.badges?.[it.property_id] : undefined} />
                ))}
              </ul>
            </section>
          ))
      )}

      {leaders.length > 0 && (
        <section aria-label="Leaderboard this week">
          <SectionTitle action={meRank >= 5 ? <span className="num text-sm text-muted">You: #{meRank + 1}</span> : undefined}>This week</SectionTitle>
          <ol className="divide-y divide-line border-y border-line bg-surface">
            {leaders.map((r, i) => (
              <li key={r.user_id ?? i} className={cn("flex min-h-12 items-center gap-3 px-4", r.user_id === d.meId && "bg-accent/8")}>
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
