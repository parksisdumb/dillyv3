import Link from "next/link";
import { money, quietLabel } from "@/lib/format";
import { PageHeader } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { TeamCard } from "@/components/team/card";
import { IconCheck, IconList, IconSettings } from "@/components/icons";
import type { PaceRow } from "@/lib/server/team";
import type { Scorecard } from "@/lib/domain/scorecard";
import { ScorecardCard } from "@/components/team/scorecard-view";

export type TeamHomeData = {
  tenantName: string;
  pace: PaceRow[];
  cold: { id: string | null; name: string | null; days_since_touch: number | null; last_touch_at: string | null }[];
  stalled: { id: string; name: string; why: string; value_estimate: number | null }[];
  health: { duplicates: number; propertiesIncomplete: number; completePct: number };
  pending: number;
  scorecard?: Scorecard | null;
  working?: { user_id: string; name: string; active: number; stale: number }[];
};

export function TeamHomeView({ d }: { d: TeamHomeData }) {
  const { tenantName, pace, cold, stalled, health, pending } = d;
  const teamToday = pace.reduce((n, r) => n + r.touchesToday, 0);
  const stalledValue = stalled.reduce((n, o) => n + (o.value_estimate ?? 0), 0);

  return (
    <div>
      <PageHeader title="Team" sub={`${tenantName} · this week`} />
      <div className="grid grid-cols-3 gap-2 px-4 pb-3">
        <Link href="/app/approvals" className={btn("secondary", "sm", "min-w-0 px-2")}>
          <span className="hidden sm:inline-flex"><IconCheck size={18} /></span> Approvals{pending > 0 && <span className="num rounded bg-accent px-1.5 text-accent-ink">{pending}</span>}
        </Link>
        <Link href="/app/team/activity" className={btn("secondary", "sm", "min-w-0 px-2")}>
          <span className="hidden sm:inline-flex"><IconList size={18} /></span> Activity
        </Link>
        <Link href="/app/admin" className={btn("secondary", "sm", "min-w-0 px-2")}>
          <span className="hidden sm:inline-flex"><IconSettings size={18} /></span> Admin
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 px-4 md:grid-cols-2">
        {d.scorecard && <ScorecardCard sc={d.scorecard} />}
        {d.working && (
          <TeamCard
            href="/app/team/working"
            title="Who's working what"
            big={d.working.reduce((n, r) => n + r.active, 0)}
            tone={d.working.some((r) => r.stale) ? "warn" : "ink"}
            sub={`active properties · ${d.working.reduce((n, r) => n + r.stale, 0)} stale`}
          >
            <ul className="divide-y divide-line">
              {d.working.slice(0, 5).map((r) => (
                <li key={r.user_id} className="num flex min-h-12 items-center gap-2 px-4 text-sm">
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                  {r.stale > 0 && <span className="font-semibold text-warning">{r.stale} stale</span>}
                  <span className="w-10 text-right font-display font-bold">{r.active}</span>
                </li>
              ))}
            </ul>
          </TeamCard>
        )}
        <TeamCard href="/app/team/pace" title="Pace" big={teamToday} sub="touches today, whole team">
          <ul className="divide-y divide-line">
            {pace.slice(0, 5).map((r) => (
              <li key={r.user_id} className="num flex min-h-12 items-center gap-2 px-4 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                <span className="text-muted">{r.touchesWeek} wk</span>
                <span className={r.followUpPct != null && r.followUpPct < 80 ? "font-semibold text-warning" : "text-muted"}>
                  {r.followUpPct == null ? "—" : `${r.followUpPct}%`} f/u
                </span>
                <span className="w-12 text-right font-display font-bold">{r.pointsWeek}</span>
              </li>
            ))}
          </ul>
        </TeamCard>
        <TeamCard href="/app/team/cold" title="Cold P1 / P2" big={cold.length} tone={cold.length ? "warn" : "good"} sub="priority accounts past their threshold">
          <ul className="divide-y divide-line">
            {cold.slice(0, 4).map((a) => (
              <li key={a.id}>
                <Link href={`/app/accounts/${a.id}`} className="flex min-h-12 items-center gap-2 px-4 text-sm hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{a.name}</span>
                  <span className="num shrink-0 text-muted">{quietLabel(a.days_since_touch, a.last_touch_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </TeamCard>
        <TeamCard href="/app/team/stalled" title="Stalled opportunities" big={stalled.length} tone={stalled.length ? "bad" : "good"} sub={`${money(stalledValue)} sitting`}>
          <ul className="divide-y divide-line">
            {stalled.slice(0, 4).map((o) => (
              <li key={o.id}>
                <Link href={`/app/pipeline/${o.id}`} className="flex min-h-12 items-center gap-2 px-4 text-sm hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
                  <span className="shrink-0 text-muted">{o.why}</span>
                  <span className="num w-14 shrink-0 text-right font-display font-bold">{money(o.value_estimate)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </TeamCard>
        <TeamCard href="/app/team/data" title="Data health" big={`${health.completePct}%`} sub="properties complete">
          <ul className="divide-y divide-line text-sm">
            <li className="num flex min-h-12 items-center justify-between px-4">
              <span>Possible duplicate contacts</span>
              <span className="font-display font-bold">{health.duplicates}</span>
            </li>
            <li className="num flex min-h-12 items-center justify-between px-4">
              <span>Properties missing roof or address</span>
              <span className="font-display font-bold">{health.propertiesIncomplete}</span>
            </li>
          </ul>
        </TeamCard>
      </div>
    </div>
  );
}
