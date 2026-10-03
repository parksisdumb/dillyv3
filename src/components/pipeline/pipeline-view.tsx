import Link from "next/link";
import { STAGES, type Stage } from "@/lib/domain/vocab";
import { money } from "@/lib/format";
import { Empty, ErrorNote, PageHeader } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { OppCard, type OppCardData } from "@/components/pipeline/opp-card";
import { IconPlus } from "@/components/icons";

export type PipelineColumn = { stage: Stage; items: OppCardData[]; total: number; stalled: number };

export function PipelineView({
  scope,
  columns,
  today,
  error,
}: {
  scope: "mine" | "all";
  columns: PipelineColumn[];
  today: string;
  error?: string | null;
}) {
  const count = columns.reduce((n, c) => n + c.items.length, 0);
  const grand = columns.reduce((n, c) => n + c.total, 0);
  return (
    <div>
      <PageHeader
        title="Pipeline"
        sub={
          <span className="num">
            {count} open · {money(grand)}
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
            className={cn("label inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm", scope === v ? "border-ink bg-ink text-ground" : "border-line")}
          >
            {v === "mine" ? "Mine" : "Everyone's"}
          </Link>
        ))}
      </div>
      {error && <ErrorNote>Couldn&apos;t load the pipeline: {error}</ErrorNote>}
      {count === 0 && !error && <Empty title="No open jobs">Log a “Bid requested” or add an opportunity from an account.</Empty>}

      {/* Mobile: grouped list */}
      {count > 0 && (
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
      {count > 0 && (
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
                      {c.stalled > 0 && <span className="font-semibold text-warning"> · {c.stalled} stalled</span>}
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
