import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { computeBadges } from "@/lib/domain/badges";
import { dayStartISO, monthStart, weekStart } from "@/lib/format";
import { MeView } from "@/components/team/me-view";

export const metadata: Metadata = { title: "Me" };

async function MePageBody() {
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
    <MeView
      d={{
        name: s.fullName ?? "Me",
        subtitle: `${s.tenant.name} · ${s.tenant.role}`,
        pts,
        streak: streak.data ?? 0,
        badges,
        recent: live.slice(0, 30).map((e) => ({ label: labels.get(e.event) ?? e.event.replace(/_/g, " "), occurred_at: e.occurred_at, points: e.points })),
        pending: pending.count ?? 0,
      }}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default function MePage() {
  return pageBody(() => MePageBody());
}
