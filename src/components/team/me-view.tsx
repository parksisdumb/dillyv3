import Link from "next/link";
import type { Badge } from "@/lib/domain/badges";
import { agoLabel } from "@/lib/format";
import { Bar, PageHeader, SectionTitle, Stat } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { IconCheck, IconStreak, IconTrophy } from "@/components/icons";

export type MeData = {
  name: string;
  subtitle: string;
  pts: { today: number; week: number; month: number; all: number };
  streak: number;
  badges: Badge[];
  recent: { label: string; occurred_at: string; points: number }[];
  pending: number;
};

export function MeView({ d }: { d: MeData }) {
  const { name, subtitle, pts, streak, badges, recent, pending } = d;
  return (
    <div>
      <PageHeader title={name} sub={subtitle} />
      <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-4">
        <Stat label="Today" value={`+${pts.today}`} />
        <Stat label="This week" value={pts.week} />
        <Stat label="This month" value={pts.month} />
        <Stat
          label="Streak"
          value={
            <span className="inline-flex items-center gap-1">
              <IconStreak size={22} className={streak > 0 ? "text-accent" : "text-muted"} />
              {streak}
            </span>
          }
          sub="cleared weekdays"
        />
      </div>

      {pending > 0 && (
        <div className="px-4 pt-4">
          <Link href="/app/approvals" className={btn("secondary", "md", "w-full")}>
            <IconCheck size={18} /> {pending} waiting for approval
          </Link>
        </div>
      )}

      <SectionTitle>Badges</SectionTitle>
      <ul className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3">
        {badges.map((b) => (
          <li key={b.key} className={cn("rounded-lg border-2 p-3", b.earned ? "border-ink bg-surface" : "border-line bg-surface opacity-80")}>
            <div className="flex items-center gap-2">
              <IconTrophy size={20} className={b.earned ? "text-accent" : "text-muted"} />
              <span className="font-display text-base font-bold">{b.label}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{b.description}</p>
            <div className="mt-2">
              <Bar value={b.progress} max={b.target} tone={b.earned ? "success" : "accent"} />
              <div className="num mt-1 text-xs text-muted">{b.earned ? "Earned" : `${b.progress}/${b.target}`}</div>
            </div>
          </li>
        ))}
      </ul>

      <SectionTitle>Recent points · {pts.all} all time</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface">
        {recent.map((e, i) => (
          <li key={i} className="flex min-h-12 items-center gap-3 px-4 text-sm">
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            <span className="num text-muted">{agoLabel(e.occurred_at)}</span>
            <span className="num w-10 text-right font-display font-bold">+{e.points}</span>
          </li>
        ))}
        {recent.length === 0 && <li className="px-4 py-4 text-sm text-muted">No points yet. Log a touch to start.</li>}
      </ul>
    </div>
  );
}
