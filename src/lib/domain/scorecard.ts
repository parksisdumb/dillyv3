// 90-day scorecard: Parks's success metrics, per rep and company, this month vs last, 13-week trend. Pure.
import { z } from "zod";

export const METRICS = {
  meetings: {
    label: "Qualified meetings",
    short: "Meetings",
    unit: "count",
    definition:
      "Touches booking an inspection or meeting a decision maker, plus meetings, roof walks and inspections where someone was met (not “not there”, voicemail, gatekeeper or not interested). Voided touches don't count.",
    target: "meetings_month",
    targetLabel: "per month, team",
  },
  paperwork: {
    label: "Onboarding paperwork",
    short: "Paperwork",
    unit: "count",
    definition: "Accounts whose onboarding first reached Paperwork received (or later) in the period, credited to the account owner.",
    target: "paperwork_month",
    targetLabel: "per month, team",
  },
  in_person: {
    label: "In-person activity",
    short: "In person",
    unit: "count",
    definition: "Touches on an in-person channel: door knock, site visit, inspection, roof walk, lunch & learn, event, meeting. Target is per rep per week.",
    target: "in_person_rep_week",
    targetLabel: "per rep per week",
  },
  first_touches: {
    label: "First touches",
    short: "First touches",
    unit: "count",
    definition: "The first touch ever logged on an account.",
    target: "first_touches_month",
    targetLabel: "per month, team",
  },
  follow_up: {
    label: "Follow-up completion",
    short: "Follow-up",
    unit: "pct",
    definition: "Tasks due in the period (not dropped) that got done — the same measure as Pace.",
    target: "follow_up_pct",
    targetLabel: "% done",
  },
} as const;
export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export const targetsSchema = z.object({
  meetings_month: z.coerce.number().int().min(0).max(100000).optional(),
  paperwork_month: z.coerce.number().int().min(0).max(100000).optional(),
  in_person_rep_week: z.coerce.number().int().min(0).max(1000).optional(),
  first_touches_month: z.coerce.number().int().min(0).max(100000).optional(),
  follow_up_pct: z.coerce.number().int().min(0).max(100).optional(),
});
export type Targets = z.infer<typeof targetsSchema>;

export function parseTargets(settings: unknown): Targets {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).scorecard_targets : null;
  const r = targetsSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export type ScoreRow = {
  user_id: string | null;
  bucket: string | null;
  period_start: string | null;
  meetings: number | null;
  in_person: number | null;
  first_touches: number | null;
  fu_due: number | null;
  fu_done: number | null;
  paperwork: number | null;
};

type Tot = { meetings: number; in_person: number; first_touches: number; paperwork: number; fu_due: number; fu_done: number };
const zero = (): Tot => ({ meetings: 0, in_person: 0, first_touches: 0, paperwork: 0, fu_due: 0, fu_done: 0 });
const add = (a: Tot, r: ScoreRow) => {
  a.meetings += r.meetings ?? 0;
  a.in_person += r.in_person ?? 0;
  a.first_touches += r.first_touches ?? 0;
  a.paperwork += r.paperwork ?? 0;
  a.fu_due += r.fu_due ?? 0;
  a.fu_done += r.fu_done ?? 0;
};
/** null when nothing was due (no rate to show). */
const value = (t: Tot, k: MetricKey): number | null => (k === "follow_up" ? (t.fu_due ? Math.round((t.fu_done / t.fu_due) * 100) : null) : t[k]);

export type MetricLine = { thisMonth: number | null; lastMonth: number | null; weeks: (number | null)[] };
export type PersonScore = { user_id: string | null; name: string; metrics: Record<MetricKey, MetricLine> };
export type Scorecard = {
  weeks: string[]; // week start dates, oldest first
  thisMonth: string;
  lastMonth: string;
  company: Record<MetricKey, MetricLine>;
  reps: PersonScore[];
  repCount: number;
  targets: Targets;
};

/** Monday-based week starts, oldest first, ending with the week containing `today`. */
export function weekStarts(today: string, n = 13): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() - 7 * i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

export function monthStarts(today: string): { thisMonth: string; lastMonth: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  return { thisMonth: `${y}-${String(m).padStart(2, "0")}-01`, lastMonth: last };
}

export function buildScorecard(rows: ScoreRow[], people: { user_id: string; name: string }[], today: string, targets: Targets): Scorecard {
  const weeks = weekStarts(today);
  const { thisMonth, lastMonth } = monthStarts(today);
  const ids: (string | null)[] = [...people.map((p) => p.user_id)];
  // Paperwork on unowned accounts still counts for the company.
  const lines = (filter: (r: ScoreRow) => boolean): Record<MetricKey, MetricLine> => {
    const wk = weeks.map(() => zero());
    const tm = zero();
    const lm = zero();
    for (const r of rows) {
      if (!filter(r)) continue;
      if (r.bucket === "week") {
        const i = weeks.indexOf(r.period_start ?? "");
        if (i >= 0) add(wk[i]!, r);
      } else if (r.bucket === "month") {
        if (r.period_start === thisMonth) add(tm, r);
        else if (r.period_start === lastMonth) add(lm, r);
      }
    }
    return Object.fromEntries(METRIC_KEYS.map((k) => [k, { thisMonth: value(tm, k), lastMonth: value(lm, k), weeks: wk.map((w) => value(w, k)) }])) as Record<MetricKey, MetricLine>;
  };
  return {
    weeks,
    thisMonth,
    lastMonth,
    company: lines(() => true),
    reps: ids.map((id) => ({ user_id: id, name: people.find((p) => p.user_id === id)?.name ?? "Unassigned", metrics: lines((r) => r.user_id === id) })),
    repCount: people.length,
    targets,
  };
}

/** Weekly equivalent of a team target, for the sparkline's goal line. */
export function weeklyGoal(k: MetricKey, t: Targets, reps: number): number | null {
  const m = METRICS[k];
  const v = t[m.target as keyof Targets];
  if (v == null || v === 0) return null;
  if (k === "follow_up") return v;
  if (k === "in_person") return v * Math.max(reps, 1);
  return Math.round(((v * 12) / 52) * 10) / 10;
}

/** Monthly team target (in-person: per rep per week × reps × 52/12). */
export function monthlyGoal(k: MetricKey, t: Targets, reps: number): number | null {
  const v = t[METRICS[k].target as keyof Targets];
  if (v == null || v === 0) return null;
  if (k === "follow_up") return v;
  if (k === "in_person") return Math.round((v * Math.max(reps, 1) * 52) / 12);
  return v;
}

/** Sparkline geometry on one scale: 0 → max(values, goal). Nulls break the line. */
export function sparkGeometry(values: (number | null)[], goal: number | null, w: number, h: number, pad = { t: 4, r: 2, b: 2, l: 2 }) {
  const max = Math.max(1, goal ?? 0, ...values.map((v) => v ?? 0));
  const n = values.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const pts = values.map((v, i) => (v == null ? null : ([x(i), y(v)] as const)));
  let line = "";
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    line += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  const real = pts.filter((p): p is readonly [number, number] => !!p);
  const base = y(0);
  const area = real.length > 1 ? `M${real[0]![0].toFixed(1)},${base.toFixed(1)}` + real.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("") + `L${real[real.length - 1]![0].toFixed(1)},${base.toFixed(1)}Z` : "";
  return { line, area, goalY: goal != null ? y(goal) : null, last: real[real.length - 1] ?? null, x, y, max };
}
