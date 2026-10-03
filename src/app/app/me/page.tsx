import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { computeBadges } from "@/lib/domain/badges";
import { agoLabel, dayStartISO, monthStart, weekStart } from "@/lib/format";
import { Bar, PageHeader, SectionTitle, Stat } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { IconCheck, IconStreak, IconTrophy } from "@/components/icons";

export const metadata: Metadata = { title: "Me" };

export default async function MePage() {
  const { sb, s, tenantId, today } = await ctx();
  const tz = s.tenant.timezone;
  const [events, days, streak, rules, pending] = await Promise.all([
    sb.from("point_event").select("event,points,occurred_at,voided").eq("tenant_id", tenantId).eq("user_id", s.userId).order("occurred_at", { ascending: false }).limit(5000),
    sb.from("rep_day").select("day,cleared").eq("tenant_id", tenantId).eq("user_id", s.userId).order("day", { ascending: false }).limit(400),
    sb.rpc("rep_streak", { p_tenant: tenantId, p_user: s.userId }),
    sb.from("point_rule").select("tenant_id,event,label").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
    sb.from("approval").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending"),
  ]);
  const live = (events.data ?? []).filter((e) => !e.voided);
  const since = (iso: string) => live.filter((e) => e.occurred_at >= iso).reduce((n, e) => n + e.points, 0);
  const pts = {
    today: since(dayStartISO(today, tz)),
    week: since(dayStartISO(weekStart(today), tz)),
    month: since(dayStartISO(monthStart(today), tz)),
    all: live.reduce((n, e) => n + e.points, 0),
  };
  const labels = new Map<string, string>();
  for (const r of (rules.data ?? []).sort((a, b) => Number(a.tenant_id != null) - Number(b.tenant_id != null))) labels.set(r.event, r.label);
  const badges = computeBadges({ pointEvents: live, repDays: days.data ?? [], today, timeZone: tz });

  return (
    <div>
      <PageHeader title={s.fullName ?? "Me"} sub={`${s.tenant.name} · ${s.tenant.role}`} />
      <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-4">
        <Stat label="Today" value={`+${pts.today}`} />
        <Stat label="This week" value={pts.week} />
        <Stat label="This month" value={pts.month} />
        <Stat
          label="Streak"
          value={
            <span className="inline-flex items-center gap-1">
              <IconStreak size={22} className={(streak.data ?? 0) > 0 ? "text-accent" : "text-muted"} />
              {streak.data ?? 0}
            </span>
          }
          sub="cleared weekdays"
        />
      </div>

      {(pending.count ?? 0) > 0 && (
        <div className="px-4 pt-4">
          <Link href="/app/approvals" className={btn("secondary", "md", "w-full")}>
            <IconCheck size={18} /> {pending.count} waiting for approval
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
        {live.slice(0, 30).map((e, i) => (
          <li key={i} className="flex min-h-12 items-center gap-3 px-4 text-sm">
            <span className="min-w-0 flex-1 truncate">{labels.get(e.event) ?? e.event.replace(/_/g, " ")}</span>
            <span className="num text-muted">{agoLabel(e.occurred_at)}</span>
            <span className="num w-10 text-right font-display font-bold">+{e.points}</span>
          </li>
        ))}
        {live.length === 0 && <li className="px-4 py-4 text-sm text-muted">No points yet. Log a touch to start.</li>}
      </ul>
    </div>
  );
}
