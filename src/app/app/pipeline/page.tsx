import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { OPEN_STAGES, STAGES } from "@/lib/domain/vocab";
import { daysInStage, isStalled } from "@/lib/domain/pipeline";
import { money } from "@/lib/format";
import { Empty, ErrorNote, PageHeader } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { OppCard, type OppCardData } from "@/components/pipeline/opp-card";
import { IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  const { sb, s, tenantId, today } = await ctx();
  const scope = sp.scope === "mine" || (!sp.scope && !s.isManager) ? "mine" : "all";

  let q = sb
    .from("opportunity")
    .select("id,name,stage,value_estimate,next_step,next_step_due,stage_changed_at,account_id,owner_user_id")
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
      } satisfies OppCardData,
    };
  });
  const columns = OPEN_STAGES.map((stage) => {
    const items = cards.filter((c) => c.stage === stage).map((c) => c.card);
    return { stage, items, total: items.reduce((n, c) => n + (c.value ?? 0), 0), stalled: items.filter((c) => c.stalled).length };
  });
  const grand = columns.reduce((n, c) => n + c.total, 0);

  return (
    <div>
      <PageHeader
        title="Pipeline"
        sub={
          <span className="num">
            {cards.length} open · {money(grand)}
          </span>
        }
        action={
          <Link href="/app/pipeline/new" className={btn("secondary", "md")}>
            <IconPlus size={18} /> New
          </Link>
        }
      />
      <div className="flex gap-2 px-4 pb-2">
        {(["mine", "all"] as const).map((v) => (
          <Link
            key={v}
            href={`/app/pipeline?scope=${v}`}
            aria-current={scope === v ? "true" : undefined}
            className={cn("label inline-flex min-h-10 items-center rounded-full border-2 px-4 text-sm", scope === v ? "border-ink bg-ink text-ground" : "border-line")}
          >
            {v === "mine" ? "Mine" : "Everyone's"}
          </Link>
        ))}
      </div>
      {error && <ErrorNote>Couldn&apos;t load the pipeline: {error.message}</ErrorNote>}
      {cards.length === 0 && !error && <Empty title="No open jobs">Log a “Bid requested” or add an opportunity from an account.</Empty>}

      {/* Mobile: grouped list */}
      {cards.length > 0 && (
        <div className="md:hidden">
          {columns
            .filter((c) => c.items.length)
            .map((c) => (
              <section key={c.stage}>
                <div className="flex items-baseline justify-between px-4 pb-2 pt-5">
                  <h2 className="label text-sm text-muted">
                    {STAGES[c.stage]} · {c.items.length}
                    {c.stalled > 0 && <span className="ml-2 text-warning">{c.stalled} stalled</span>}
                  </h2>
                  <span className="num font-display font-bold">{money(c.total)}</span>
                </div>
                <ul className="divide-y divide-line border-y border-line bg-surface">
                  {c.items.map((o) => (
                    <li key={o.id}>
                      <OppCard o={o} today={today} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {/* Desktop: board */}
      {cards.length > 0 && (
        <div className="hidden md:relative md:left-1/2 md:block md:w-[min(calc(100vw-2rem),88rem)] md:-translate-x-1/2">
          <div className="grid grid-cols-6 gap-3 px-2 pt-3">
            {columns.map((c) => (
              <section key={c.stage} className="min-w-0">
                <div className="mb-2 border-b-2 border-ink pb-1">
                  <div className="label truncate text-xs text-muted">{STAGES[c.stage]}</div>
                  <div className="flex items-baseline justify-between">
                    <span className="num font-display text-xl font-bold">{money(c.total)}</span>
                    <span className="num text-sm text-muted">
                      {c.items.length}
                      {c.stalled > 0 && <span className="text-warning"> · {c.stalled}!</span>}
                    </span>
                  </div>
                </div>
                <ul className="flex flex-col gap-2">
                  {c.items.map((o) => (
                    <li key={o.id}>
                      <OppCard o={o} today={today} compact />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
