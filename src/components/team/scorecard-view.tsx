import { METRIC_KEYS, METRICS, monthlyGoal, weeklyGoal, type MetricKey, type MetricLine, type Scorecard } from "@/lib/domain/scorecard";
import { PageHeader, SectionTitle } from "@/components/ui/bits";
import { cn } from "@/components/ui/styles";
import { TeamCard } from "@/components/team/card";
import { Table, Td } from "@/components/team/table";
import { Sparkline } from "@/components/team/sparkline";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (d: string) => MONTH[Number(d.slice(5, 7)) - 1] ?? d;
const fmt = (k: MetricKey, v: number | null) => (v == null ? "—" : METRICS[k].unit === "pct" ? `${v}%` : v.toLocaleString());

function Delta({ k, line, last }: { k: MetricKey; line: MetricLine; last: string }) {
  if (line.lastMonth == null) return <span className="text-muted">— in {last}</span>;
  const d = line.thisMonth == null ? null : line.thisMonth - line.lastMonth;
  const unit = METRICS[k].unit === "pct" ? " pts" : "";
  return (
    <span className="num">
      <span className="text-muted">{fmt(k, line.lastMonth)} in {last}</span>
      {d != null && d !== 0 && (
        <span className={cn("ml-1.5 font-semibold", d > 0 ? "text-success" : "text-muted")}>
          {d > 0 ? "▲" : "▼"} {Math.abs(d)}
          {unit}
        </span>
      )}
    </span>
  );
}

/** Team home card: qualified meetings this month, plus a compact row per metric. */
export function ScorecardCard({ sc }: { sc: Scorecard }) {
  const m = sc.company.meetings;
  const goal = monthlyGoal("meetings", sc.targets, sc.repCount);
  return (
    <TeamCard
      href="/app/team/scorecard"
      title="90-day scorecard"
      big={
        <>
          {fmt("meetings", m.thisMonth)}
          {goal != null && <span className="text-xl font-semibold text-muted"> / {goal}</span>}
        </>
      }
      sub={`qualified meetings in ${monthName(sc.thisMonth)} · ${fmt("meetings", m.lastMonth)} in ${monthName(sc.lastMonth)}`}
    >
      <ul className="divide-y divide-line">
        {METRIC_KEYS.filter((k) => k !== "meetings").map((k) => (
          <li key={k} className="grid min-h-12 grid-cols-[1fr_auto_5.5rem] items-center gap-3 px-4 text-sm">
            <span className="truncate font-semibold">{METRICS[k].short}</span>
            <span className="num text-right">
              <span className="font-display font-bold">{fmt(k, sc.company[k].thisMonth)}</span>
              <span className="text-muted"> / {fmt(k, sc.company[k].lastMonth)}</span>
            </span>
            <Sparkline values={sc.company[k].weeks} weeks={sc.weeks} goal={weeklyGoal(k, sc.targets, sc.repCount)} unit={METRICS[k].unit === "pct" ? "%" : ""} label={METRICS[k].label} width={120} height={32} />
          </li>
        ))}
      </ul>
    </TeamCard>
  );
}

function MetricCard({ k, sc }: { k: MetricKey; sc: Scorecard }) {
  const line = sc.company[k];
  const goal = monthlyGoal(k, sc.targets, sc.repCount);
  const pct = goal && line.thisMonth != null ? Math.min(100, Math.round((line.thisMonth / goal) * 100)) : null;
  const wk = weeklyGoal(k, sc.targets, sc.repCount);
  return (
    <section className="min-w-0 rounded-lg border-2 border-line bg-surface p-4" aria-labelledby={`m-${k}`}>
      <h2 id={`m-${k}`} className="label text-xs text-muted">
        {METRICS[k].label}
      </h2>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="num font-display text-4xl font-extrabold leading-none">{fmt(k, line.thisMonth)}</span>
        {goal != null && (
          <span className="num text-sm text-muted">
            of {fmt(k, goal)} goal
          </span>
        )}
      </div>
      <div className="mt-1 text-sm">
        <span className="text-muted">{monthName(sc.thisMonth)} to date · </span>
        <Delta k={k} line={line} last={monthName(sc.lastMonth)} />
      </div>
      {pct != null && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={`${METRICS[k].label} toward goal`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-3">
        <Sparkline values={line.weeks} weeks={sc.weeks} goal={wk} unit={METRICS[k].unit === "pct" ? "%" : ""} label={METRICS[k].label} />
        <div className="num mt-1 flex justify-between text-[11px] text-muted">
          <span>13 weeks ago</span>
          <span>{wk != null ? `goal ≈ ${wk}${METRICS[k].unit === "pct" ? "%" : ""}/wk` : "no goal set"}</span>
          <span>this week</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{METRICS[k].definition}</p>
    </section>
  );
}

export function ScorecardView({ sc, tenantName, targetsForm }: { sc: Scorecard; tenantName: string; targetsForm?: React.ReactNode }) {
  const reps = sc.reps.filter((r) => r.user_id);
  return (
    <div className="lg:relative lg:left-1/2 lg:w-[min(1180px,calc(100vw-48px))] lg:-translate-x-1/2">
      <PageHeader back="/app/team" title="90-day scorecard" sub={`${tenantName} · ${monthName(sc.thisMonth)} vs ${monthName(sc.lastMonth)} · weekly trend, last 13 weeks`} />
      <div className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRIC_KEYS.map((k) => (
          <MetricCard key={k} k={k} sc={sc} />
        ))}
      </div>

      <SectionTitle>By rep — {monthName(sc.thisMonth)} (last month)</SectionTitle>
      <Table head={["Rep", ...METRIC_KEYS.map((k) => METRICS[k].short), "In person / wk"]}>
        {reps.map((r) => {
          const ip = r.metrics.in_person.weeks.slice(-4);
          const avg = Math.round((ip.reduce<number>((n, v) => n + (v ?? 0), 0) / ip.length) * 10) / 10;
          const target = sc.targets.in_person_rep_week;
          return (
            <tr key={r.user_id}>
              <Td className="font-semibold">{r.name}</Td>
              {METRIC_KEYS.map((k) => (
                <Td key={k} num>
                  <span className="font-display font-bold">{fmt(k, r.metrics[k].thisMonth)}</span>
                  <span className="text-muted"> ({fmt(k, r.metrics[k].lastMonth)})</span>
                </Td>
              ))}
              <Td num className={cn(target != null && avg < target && "font-semibold text-warning")}>
                {avg}
                {target != null && <span className="text-muted"> / {target}</span>}
              </Td>
            </tr>
          );
        })}
        <tr className="border-t-2 border-ink">
          <Td className="font-semibold">Company</Td>
          {METRIC_KEYS.map((k) => (
            <Td key={k} num>
              <span className="font-display font-bold">{fmt(k, sc.company[k].thisMonth)}</span>
              <span className="text-muted"> ({fmt(k, sc.company[k].lastMonth)})</span>
            </Td>
          ))}
          <Td num>
            {Math.round((sc.company.in_person.weeks.slice(-4).reduce<number>((n, v) => n + (v ?? 0), 0) / 4 / Math.max(reps.length, 1)) * 10) / 10}
          </Td>
        </tr>
      </Table>
      <p className="px-4 pt-2 text-xs text-muted">In person / wk = average of the last 4 weeks. Weeks start Monday, in {tenantName}&apos;s time zone.</p>
      {targetsForm}
    </div>
  );
}
