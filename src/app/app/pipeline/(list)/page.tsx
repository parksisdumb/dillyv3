import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { OPEN_STAGES } from "@/lib/domain/vocab";
import { daysInStage, isStalled } from "@/lib/domain/pipeline";
import type { OppCardData } from "@/components/pipeline/opp-card";
import { PipelineView } from "@/components/pipeline/pipeline-view";

export const metadata: Metadata = { title: "Pipeline" };

async function PipelinePageBody({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  const { sb, s, tenantId, today } = await ctx();
  const scope = sp.scope === "mine" || (!sp.scope && !s.isManager) ? "mine" : "all";

  let q = sb
    .from("opportunity")
    .select("id,name,stage,value_estimate,next_step,next_step_due,stage_changed_at,account_id,owner_user_id,service_line")
    .eq("tenant_id", tenantId)
    .eq("is_test", false)
    .in("stage", OPEN_STAGES);
  if (scope === "mine") q = q.eq("owner_user_id", s.userId);
  const { data, error } = await q.order("value_estimate", { ascending: false, nullsFirst: false }).limit(500);

  const acctIds = [...new Set((data ?? []).map((o) => o.account_id).filter((x): x is string => !!x))];
  const { data: accts } = acctIds.length ? await sb.from("account").select("id,name").in("id", acctIds) : { data: [] };
  const names = new Map((accts ?? []).map((a) => [a.id, a.name]));

  const cards = (data ?? []).map((o) => {
    const d = daysInStage(o.stage_changed_at, today);
    return {
      stage: o.stage,
      card: {
        id: o.id,
        name: o.name,
        account: o.account_id ? names.get(o.account_id) ?? null : null,
        value: o.value_estimate,
        daysInStage: d,
        stalled: isStalled(o.stage, d),
        next_step: o.next_step,
        next_step_due: o.next_step_due,
        service_line: o.service_line,
      } satisfies OppCardData,
    };
  });
  const columns = OPEN_STAGES.map((stage) => {
    const items = cards.filter((c) => c.stage === stage).map((c) => c.card);
    return { stage, items, total: items.reduce((n, c) => n + (c.value ?? 0), 0), stalled: items.filter((c) => c.stalled).length };
  });

  return <PipelineView scope={scope} columns={columns} today={today} error={error?.message} />;
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function PipelinePage(props: Parameters<typeof PipelinePageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return pageBody(() => PipelinePageBody(props), key);
}
