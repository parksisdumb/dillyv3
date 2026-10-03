import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadCold, loadDataHealth, loadPace, loadStalled } from "@/lib/server/team";
import { money, quietLabel } from "@/lib/format";
import { PageHeader } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { TeamCard } from "@/components/team/card";
import { IconCheck, IconList } from "@/components/icons";

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
  const teamToday = pace.reduce((n, r) => n + r.touchesToday, 0);
  const stalledValue = stalled.reduce((n, o) => n + (o.value_estimate ?? 0), 0);

  return (
    <div>
      <PageHeader title="Team" sub={`${c.s.tenant.name} · this week`} />
      <div className="flex gap-2 px-4 pb-3">
        <Link href="/app/approvals" className={btn("secondary", "md", "flex-1")}>
          <IconCheck size={18} /> Approvals{(pending.count ?? 0) > 0 && <span className="num rounded bg-accent px-1.5 text-accent-ink">{pending.count}</span>}
        </Link>
        <Link href="/app/team/activity" className={btn("secondary", "md", "flex-1")}>
          <IconList size={18} /> Activity
        </Link>
      </div>
      <div className="grid gap-3 px-4 md:grid-cols-2">
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
              <li key={a.id} className="flex min-h-12 items-center gap-2 px-4 text-sm">
                <Link href={`/app/accounts/${a.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                  {a.name}
                </Link>
                <span className="num text-muted">{quietLabel(a.days_since_touch, a.last_touch_at)}</span>
              </li>
            ))}
          </ul>
        </TeamCard>
        <TeamCard href="/app/team/stalled" title="Stalled opportunities" big={stalled.length} tone={stalled.length ? "bad" : "good"} sub={`${money(stalledValue)} sitting`}>
          <ul className="divide-y divide-line">
            {stalled.slice(0, 4).map((o) => (
              <li key={o.id} className="flex min-h-12 items-center gap-2 px-4 text-sm">
                <Link href={`/app/pipeline/${o.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                  {o.name}
                </Link>
                <span className="text-muted">{o.why}</span>
                <span className="num w-14 text-right font-display font-bold">{money(o.value_estimate)}</span>
              </li>
            ))}
          </ul>
        </TeamCard>
        <TeamCard href="/app/team/data" title="Data health" big={`${health.completePct}%`} sub="properties complete">
          <ul className="divide-y divide-line text-sm">
            <li className="num flex min-h-12 items-center justify-between px-4">
              <span>Possible duplicate contacts</span>
              <span className="font-display font-bold">{health.duplicateGroups.length}</span>
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
