import type { Metadata } from "next";
import { pageBody } from "@/components/status/page-boundary";
import { adminCtx } from "@/lib/server/admin";
import { parseTeamGoal } from "@/lib/domain/team-goal";
import { parseTargets } from "@/lib/domain/scorecard";
import { CompanyBasics, knownTargetingValues, MarketsSection, ReminderRules, ScorecardTargets, TargetingEditor, TeamGoalForm } from "@/components/admin/company-sections";

export const metadata: Metadata = { title: "Admin · Company" };

async function CompanyBody() {
  const c = await adminCtx();
  const { sb, tenantId } = c;
  const [tenant, tms, markets, targeting] = await Promise.all([
    sb.from("tenant").select("name,brand_name,timezone,settings").eq("id", tenantId).single(),
    sb.from("tenant_market").select("market_id,role").eq("tenant_id", tenantId),
    sb.from("market").select("id,slug,name,state").order("name"),
    sb.from("tenant_targeting").select("dimension,value,mode,weight,note").eq("tenant_id", tenantId).order("dimension").order("value"),
  ]);
  if (!tenant.data) throw new Error(`tenant ${tenantId}: ${tenant.error?.message}`);
  const all = markets.data ?? [];
  const byId = new Map(all.map((m) => [m.id, m]));
  const order = { primary: 0, secondary: 1, travel: 2 } as Record<string, number>;
  const mine = (tms.data ?? [])
    .flatMap((t) => {
      const m = byId.get(t.market_id);
      return m ? [{ slug: m.slug, name: m.name, role: t.role }] : [];
    })
    .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.name.localeCompare(b.name));
  const settings = (tenant.data.settings ?? {}) as Record<string, unknown>;
  return (
    <div>
      <CompanyBasics t={tenant.data} />
      <MarketsSection mine={mine} all={all} />
      <ReminderRules settings={settings} />
      <TeamGoalForm goal={parseTeamGoal(settings)} />
      <ScorecardTargets t={parseTargets(settings)} />
      <TargetingEditor tenantName={c.s.tenant.name} rows={(targeting.data ?? []).map((t) => ({ ...t, weight: t.weight == null ? null : Number(t.weight) }))} known={knownTargetingValues(mine.map((m) => m.slug))} />
    </div>
  );
}

export default function CompanyPage() {
  return pageBody(() => CompanyBody());
}
