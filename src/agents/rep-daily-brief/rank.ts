/**
 * Rep Daily Brief — pure ranking core (spec 04-POD-3 §3.12). No I/O, no clock reads: everything is an input.
 *
 * rank()         → ordered queue with a one-line "why", the "one thing", Due/New counts,
 *                  manager escalations, auto-snooze prompts, and push-reminder decisions (the ladder).
 */
import type { Database, Json } from "@/lib/db/database.types";
import { businessDaysBetween, daysBetween, hhmmToMinutes, isWeekend, localClock, type LocalClock } from "../runtime/clock";

export type QueueRow = Database["public"]["Functions"]["rep_queue"]["Returns"][number];

export interface OpenOpportunity {
  id: string;
  name: string;
  accountId: string | null;
  accountName: string | null;
  value: number | null;
  stage: string;
  daysInStage: number;
  nextStep: string | null;
  nextStepDue: string | null;
}

export interface NewSignal {
  id: string;
  kind: string;
  headline: string;
  accountId: string | null;
  accountName: string | null;
  occurredAt: string; // ISO timestamp
  weight?: number;
}

export interface BriefSettings {
  timeZone: string;
  weekendReminders: boolean;
  /** "Due today, P1 account or opp ≥ $25K" → push. */
  bigDealUsd: number;
  /** A proposal/negotiation with no stage change for this many days is stalled. */
  stallDays: number;
  /** Push window, tenant-local HH:MM. Nothing outside it. */
  pushWindowStart: string;
  pushWindowEnd: string;
  maxPushesPerDay: number;
  /** Ladder times. */
  ladderPushAt: string;
  escalateAfterBusinessDays: number;
  snoozeAfterDays: number;
}

export const DEFAULT_SETTINGS: Omit<BriefSettings, "timeZone"> = {
  weekendReminders: false,
  bigDealUsd: 25_000,
  stallDays: 10,
  pushWindowStart: "07:00",
  pushWindowEnd: "19:00",
  maxPushesPerDay: 3,
  ladderPushAt: "08:00",
  escalateAfterBusinessDays: 3,
  snoozeAfterDays: 14,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** tenant.settings jsonb → typed settings. Unknown/invalid keys fall back to defaults. */
export function settingsFromTenant(timeZone: string, raw: Json | null | undefined): BriefSettings {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Json | undefined>) : {};
  const num = (v: Json | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const hhmm = (v: Json | undefined, d: string) => (typeof v === "string" && HHMM.test(v) ? v : d);
  // tenant.settings.quiet_hours = ["19:00","07:00"] (quiet from → until), as seeded; {start,end} also accepted.
  // The push window is the complement: until → from.
  const rawQh = s.quiet_hours;
  const qh: { start?: Json; end?: Json } = Array.isArray(rawQh)
    ? { start: rawQh[0], end: rawQh[1] }
    : rawQh && typeof rawQh === "object"
      ? (rawQh as { start?: Json; end?: Json })
      : {};
  let windowStart = hhmm(qh.end, DEFAULT_SETTINGS.pushWindowStart);
  let windowEnd = hhmm(qh.start, DEFAULT_SETTINGS.pushWindowEnd);
  if (hhmmToMinutes(windowStart) >= hhmmToMinutes(windowEnd)) {
    windowStart = DEFAULT_SETTINGS.pushWindowStart; // window must not wrap midnight
    windowEnd = DEFAULT_SETTINGS.pushWindowEnd;
  }
  return {
    timeZone,
    weekendReminders: s.weekend_reminders === true,
    bigDealUsd: num(s.big_deal_usd, DEFAULT_SETTINGS.bigDealUsd),
    stallDays: num(s.stall_days, DEFAULT_SETTINGS.stallDays) || DEFAULT_SETTINGS.stallDays,
    pushWindowStart: windowStart,
    pushWindowEnd: windowEnd,
    // Spec cap is 3; a tenant may lower it, never raise it.
    maxPushesPerDay: Math.min(num(s.max_pushes_per_day, 3), 3),
    ladderPushAt: DEFAULT_SETTINGS.ladderPushAt,
    escalateAfterBusinessDays: DEFAULT_SETTINGS.escalateAfterBusinessDays,
    snoozeAfterDays: DEFAULT_SETTINGS.snoozeAfterDays,
  };
}

export type ItemType = "task" | "reengage" | "first_touch" | "opportunity" | "signal" | "appointment";

/** A scheduled appointment today (company-local start), for the brief, the queue top and the reminder push. */
export interface TodayAppointment {
  id: string;
  title: string;
  kind: string;
  /** ISO start. */
  startsAt: string;
  allDay: boolean;
  /** "1801 S Pleasant Valley Rd, Austin, TX" or the first building's name. */
  place: string | null;
  buildings: number;
  accountId: string | null;
  accountName: string | null;
  /** Push this many minutes before the start (0 = no reminder). */
  reminderMinutes: number;
}

export interface RankedItem {
  key: string;
  type: ItemType;
  title: string;
  why: string;
  score: number;
  accountId: string | null;
  accountName: string | null;
  contactName: string | null;
  phone: string | null;
  taskId: string | null;
  opportunityId: string | null;
  signalId: string | null;
  dueOn: string | null;
  overdueDays: number;
  overdueBusinessDays: number;
  icpTier: number | null;
  value: number | null;
  /** Overdue > snoozeAfterDays: ask the rep done elsewhere / not now / drop. */
  snoozePrompt: boolean;
  /** P1/P2 overdue > N business days: goes to the manager, not another push. */
  escalate: boolean;
  /** type 'appointment' only. */
  appointmentId?: string | null;
}

export type OneThingKind = "stalled_proposal" | "hot_reply" | "p1_going_cold" | "overdue_follow_ups" | "top_item";

export interface OneThing {
  kind: OneThingKind;
  text: string;
  itemKey: string | null;
  value: number | null;
}

export interface DueCounts {
  followUps: number;
  dueToday: number;
  overdue: number;
  firstTouches: number;
  reengage: number;
  opportunityNextSteps: number;
  routeStops: number | null;
  /** "9:00 at Greystar Riverside" — the first appointment today. */
  firstMeetingAt: string | null;
  /** Appointments today. */
  appointments?: number;
}

export interface NewCounts {
  signals: number;
  replies: number;
  assignments: number;
  topSignal: string | null;
}

export interface Escalation {
  taskId: string;
  title: string;
  accountName: string | null;
  icpTier: number;
  overdueBusinessDays: number;
  dueOn: string;
}

export interface SnoozePrompt {
  taskId: string;
  title: string;
  accountName: string | null;
  overdueDays: number;
}

export type PushKind = "signal" | "due_today_big" | "overdue_group" | "appointment";

export interface PushDecision {
  key: string; // dedupe key, stable for the day
  kind: PushKind;
  at: string; // tenant-local HH:MM it becomes eligible
  dueNow: boolean; // eligible at `clock` (false when no clock was given)
  title: string;
  body: string;
  itemKeys: string[];
}

export interface PushSuppression {
  key: string;
  reason: "cap" | "quiet_hours" | "weekend" | "already_sent";
}

export interface RankInput {
  today: string;
  queue: QueueRow[];
  opportunities: OpenOpportunity[];
  signals: NewSignal[];
  settings: BriefSettings;
  doNotPursueAccountIds?: string[];
  extras?: { routeStops?: number | null; firstMeetingAt?: string | null; newAssignments?: number };
  /** Today's scheduled appointments for this rep (any order; ranked by start time). */
  appointments?: TodayAppointment[];
  /** Current tenant-local time. Needed for `dueNow` on pushes. */
  clock?: LocalClock;
  /** Push keys already delivered today for this rep (cap + dedupe). */
  pushesSentToday?: string[];
}

export interface Ranked {
  items: RankedItem[];
  oneThing: OneThing | null;
  due: DueCounts;
  new: NewCounts;
  escalations: Escalation[];
  snoozePrompts: SnoozePrompt[];
  pushes: PushDecision[];
  suppressedPushes: PushSuppression[];
  isEmpty: boolean;
}

export const MAX_LINE = 140;
const REPLY_KINDS = new Set(["inbound_reply", "reply", "email_reply", "sms_reply"]);
const LATE_STAGES = new Set(["proposal_sent", "negotiation"]);
const STAGE_LABEL: Record<string, string> = {
  lead: "Lead",
  contacted: "Contacted",
  inspection_scheduled: "Inspection scheduled",
  inspection_complete: "Inspection complete",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
};

export function clip(s: string, max = MAX_LINE): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

export function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 10_000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export function isReplySignal(s: Pick<NewSignal, "kind">): boolean {
  return REPLY_KINDS.has(s.kind);
}

function isStalledBig(o: OpenOpportunity, today: string, st: BriefSettings): boolean {
  if (!LATE_STAGES.has(o.stage) || (o.value ?? 0) < st.bigDealUsd) return false;
  return o.daysInStage >= st.stallDays || (o.nextStepDue !== null && o.nextStepDue < today);
}

function join(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function rank(input: RankInput): Ranked {
  const { today, settings: st } = input;
  const dnp = new Set(input.doNotPursueAccountIds ?? []);
  const oppById = new Map(input.opportunities.map((o) => [o.id, o]));
  const items: RankedItem[] = [];
  const oppsCoveredByTask = new Set<string>();

  // 1) rep_queue rows (tasks due/overdue, cold P1/P2 re-engage, first touches).
  for (const r of input.queue) {
    if (r.account_id && dnp.has(r.account_id)) continue;
    const type = (r.item_type ?? "task") as ItemType;
    const opp = r.opportunity_id ? oppById.get(r.opportunity_id) : undefined;
    if (r.opportunity_id) oppsCoveredByTask.add(r.opportunity_id);
    const overdueDays = r.overdue_days ?? 0;
    const overdueBusinessDays = r.due_on ? businessDaysBetween(r.due_on, today) : 0;
    const tier = r.icp_tier ?? null;
    const value = opp?.value ?? null;
    const isTask = type === "task";
    const snoozePrompt = isTask && overdueDays > st.snoozeAfterDays;
    const escalate =
      isTask && !snoozePrompt && tier !== null && tier <= 2 && overdueBusinessDays > st.escalateAfterBusinessDays;
    const why = isTask
      ? join([
          overdueDays > 0 ? `Overdue ${overdueDays}d` : "Due today",
          tier ? `P${tier}` : null,
          value ? `${fmtUsd(value)} ${STAGE_LABEL[opp!.stage]?.toLowerCase() ?? "opp"}` : null,
          r.reason,
        ])
      : r.reason || (type === "first_touch" ? "Assigned, never touched" : "Gone quiet");
    items.push({
      key: r.task_id ? `task:${r.task_id}` : `${type}:${r.account_id}`,
      type,
      title: r.title ?? "Untitled",
      why: clip(why),
      score: Number(r.score ?? 0),
      accountId: r.account_id,
      accountName: r.account_name,
      contactName: r.contact_name,
      phone: r.phone,
      taskId: r.task_id,
      opportunityId: r.opportunity_id,
      signalId: null,
      dueOn: r.due_on,
      overdueDays,
      overdueBusinessDays,
      icpTier: tier,
      value,
      snoozePrompt,
      escalate,
    });
  }

  // 2) Opportunities whose next step is due, or big late-stage deals that stalled, with no task covering them.
  for (const o of input.opportunities) {
    if (oppsCoveredByTask.has(o.id) || (o.accountId && dnp.has(o.accountId))) continue;
    const stepDue = o.nextStepDue !== null && o.nextStepDue <= today;
    const stalled = isStalledBig(o, today, st);
    if (!stepDue && !stalled) continue;
    const late = o.nextStepDue ? Math.max(daysBetween(o.nextStepDue, today), 0) : 0;
    items.push({
      key: `opp:${o.id}`,
      type: "opportunity",
      title: clip(`${o.accountName ?? o.name}: ${o.nextStep ?? "set the next step"}`),
      why: clip(
        join([
          `${STAGE_LABEL[o.stage] ?? o.stage} ${o.daysInStage}d`,
          o.value ? fmtUsd(o.value) : null,
          stalled ? "stalled" : null,
          late > 0 ? `next step ${late}d late` : stepDue ? "next step due today" : null,
        ]),
      ),
      score: 50 + Math.min((o.value ?? 0) / 5000, 40) + Math.min(late * 2, 20) + (stalled ? 15 : 0),
      accountId: o.accountId,
      accountName: o.accountName,
      contactName: null,
      phone: null,
      taskId: null,
      opportunityId: o.id,
      signalId: null,
      dueOn: o.nextStepDue,
      overdueDays: late,
      overdueBusinessDays: o.nextStepDue ? businessDaysBetween(o.nextStepDue, today) : 0,
      icpTier: null,
      value: o.value,
      snoozePrompt: false,
      escalate: false,
    });
  }

  // 3) New signals on accounts the rep owns.
  const signals = input.signals.filter((s) => !(s.accountId && dnp.has(s.accountId)));
  const maxOppValueByAccount = new Map<string, number>();
  for (const o of input.opportunities) {
    if (!o.accountId) continue;
    maxOppValueByAccount.set(o.accountId, Math.max(maxOppValueByAccount.get(o.accountId) ?? 0, o.value ?? 0));
  }
  for (const s of signals) {
    const reply = isReplySignal(s);
    const value = s.accountId ? maxOppValueByAccount.get(s.accountId) ?? null : null;
    items.push({
      key: `signal:${s.id}`,
      type: "signal",
      title: clip(s.accountName ? `${s.accountName}: ${s.headline}` : s.headline),
      why: clip(join([reply ? "Inbound reply — answer fast" : `New ${s.kind.replace(/_/g, " ")} signal`, value ? `${fmtUsd(value)} open` : null])),
      score: reply ? 95 + Math.min((value ?? 0) / 10_000, 20) : 55 + 10 * (s.weight ?? 1),
      accountId: s.accountId,
      accountName: s.accountName,
      contactName: null,
      phone: null,
      taskId: null,
      opportunityId: null,
      signalId: s.id,
      dueOn: null,
      overdueDays: 0,
      overdueBusinessDays: 0,
      icpTier: null,
      value,
      snoozePrompt: false,
      escalate: false,
    });
  }

  items.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  // 4) Today's appointments lead the day, in time order (they're commitments, not suggestions).
  const appts = [...(input.appointments ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const apptItems: RankedItem[] = appts.map((a, i) => {
    const at = a.allDay ? "All day" : apptClock(a.startsAt, st.timeZone);
    return {
      key: `appt:${a.id}`,
      type: "appointment",
      title: clip(a.title),
      why: clip(join([at, a.place, a.buildings > 1 ? `${a.buildings} buildings` : null])),
      score: 1000 - i,
      accountId: a.accountId,
      accountName: a.accountName,
      contactName: null,
      phone: null,
      taskId: null,
      opportunityId: null,
      signalId: null,
      dueOn: today,
      overdueDays: 0,
      overdueBusinessDays: 0,
      icpTier: null,
      value: null,
      snoozePrompt: false,
      escalate: false,
      appointmentId: a.id,
    };
  });
  items.unshift(...apptItems);

  const oneThing = pickOneThing(items.filter((x) => x.type !== "appointment"), input.opportunities, signals, today, st);
  if (oneThing?.itemKey) {
    // The one thing leads the work queue, right after today's appointments.
    const i = items.findIndex((x) => x.key === oneThing.itemKey);
    if (i > apptItems.length) items.splice(apptItems.length, 0, ...items.splice(i, 1));
  }

  const tasks = items.filter((i) => i.type === "task");
  const due: DueCounts = {
    followUps: tasks.length,
    dueToday: tasks.filter((t) => t.overdueDays === 0).length,
    overdue: tasks.filter((t) => t.overdueDays > 0).length,
    firstTouches: items.filter((i) => i.type === "first_touch").length,
    reengage: items.filter((i) => i.type === "reengage").length,
    opportunityNextSteps: items.filter((i) => i.type === "opportunity").length,
    routeStops: input.extras?.routeStops ?? null,
    firstMeetingAt: appts.length ? firstMeetingLine(appts, st.timeZone) : input.extras?.firstMeetingAt ?? null,
    appointments: appts.length,
  };
  const replies = signals.filter(isReplySignal);
  const others = signals.filter((s) => !isReplySignal(s)).sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
  const top = others[0];
  const news: NewCounts = {
    signals: others.length,
    replies: replies.length,
    assignments: input.extras?.newAssignments ?? 0,
    topSignal: top ? (top.accountName ? `${top.headline} — ${top.accountName}` : top.headline) : null,
  };

  const escalations: Escalation[] = tasks
    .filter((t) => t.escalate)
    .map((t) => ({
      taskId: t.taskId!,
      title: t.title,
      accountName: t.accountName,
      icpTier: t.icpTier!,
      overdueBusinessDays: t.overdueBusinessDays,
      dueOn: t.dueOn!,
    }));
  const snoozePrompts: SnoozePrompt[] = tasks
    .filter((t) => t.snoozePrompt)
    .map((t) => ({ taskId: t.taskId!, title: t.title, accountName: t.accountName, overdueDays: t.overdueDays }));

  const { pushes, suppressed } = decidePushes({
    today,
    items,
    signals,
    settings: st,
    clock: input.clock,
    sent: input.pushesSentToday ?? [],
    appointments: appts,
  });

  return {
    items,
    oneThing,
    due,
    new: news,
    escalations,
    snoozePrompts,
    pushes,
    suppressedPushes: suppressed,
    isEmpty: items.length === 0,
  };
}

/** "9:00" / "1:30" in the company's zone (brief copy: short, no AM/PM noise for a working day). */
export function apptClock(iso: string, timeZone: string): string {
  const c = localClock(timeZone, new Date(iso));
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12;
  return `${h12}:${String(c.minute).padStart(2, "0")}${c.hour >= 12 ? " PM" : ""}`;
}

/** "9:00 at Greystar Riverside" (or "9:00 · Inspection · Greystar" with no place). */
export function firstMeetingLine(appts: TodayAppointment[], timeZone: string): string {
  const timed = appts.filter((a) => !a.allDay);
  const a = timed[0] ?? appts[0];
  const at = a.allDay ? "today" : apptClock(a.startsAt, timeZone);
  const where = a.accountName ?? a.place ?? a.title;
  return clip(`${at} at ${where}`, 80);
}

/**
 * The one thing: highest value × urgency, by rung —
 * stalled big proposal > hot reply > P1 going cold > overdue follow-ups > top of queue.
 */
function pickOneThing(
  items: RankedItem[],
  opps: OpenOpportunity[],
  signals: NewSignal[],
  today: string,
  st: BriefSettings,
): OneThing | null {
  const stalled = opps
    .filter((o) => isStalledBig(o, today, st))
    .map((o) => ({ o, urgency: 1 + Math.min(o.daysInStage, 60) / 30 + (o.nextStepDue && o.nextStepDue < today ? 0.5 : 0) }))
    .sort((a, b) => (b.o.value ?? 0) * b.urgency - (a.o.value ?? 0) * a.urgency);
  if (stalled.length) {
    const { o } = stalled[0];
    const itemKey = items.find((i) => i.opportunityId === o.id)?.key ?? null;
    const who = o.accountName ?? o.name;
    return {
      kind: "stalled_proposal",
      text: clip(
        `Move the ${fmtUsd(o.value ?? 0)} ${who} deal — ${o.daysInStage} days in ${(STAGE_LABEL[o.stage] ?? o.stage).toLowerCase()}` +
          (o.nextStep ? `. Next: ${o.nextStep}` : ". Set a next step today"),
      ),
      itemKey,
      value: o.value,
    };
  }

  const replies = items.filter((i) => i.type === "signal" && signals.some((s) => s.id === i.signalId && isReplySignal(s)));
  if (replies.length) {
    const r = replies.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.score - a.score)[0];
    const sig = signals.find((s) => s.id === r.signalId)!;
    return {
      kind: "hot_reply",
      text: clip(`Answer the reply from ${sig.accountName ?? "an inbound lead"} first — ${sig.headline}`),
      itemKey: r.key,
      value: r.value,
    };
  }

  const coldP1 = items.filter((i) => i.type === "reengage" && i.icpTier === 1);
  if (coldP1.length) {
    const c = coldP1[0];
    return {
      kind: "p1_going_cold",
      text: clip(`Re-engage ${c.accountName ?? c.title} before it goes cold — ${c.why}`),
      itemKey: c.key,
      value: c.value,
    };
  }

  const overdue = items.filter((i) => i.type === "task" && i.overdueDays > 0);
  if (overdue.length) {
    const t = overdue[0];
    const lead = overdue.length === 1 ? "Clear your overdue follow-up" : `Clear ${overdue.length} overdue follow-ups`;
    return {
      kind: "overdue_follow_ups",
      text: clip(`${lead} — start with ${t.accountName ? `${t.accountName}: ` : ""}${t.title} (${t.overdueDays}d late)`),
      itemKey: t.key,
      value: t.value,
    };
  }

  const first = items[0];
  if (!first) return null;
  return { kind: "top_item", text: clip(`Start with ${first.title} — ${first.why}`), itemKey: first.key, value: first.value };
}

interface PushArgs {
  today: string;
  items: RankedItem[];
  signals: NewSignal[];
  settings: BriefSettings;
  clock?: LocalClock;
  sent: string[];
  appointments?: TodayAppointment[];
}

/** Push keys for appointment reminders; they don't count toward the daily cap. */
export const isApptPushKey = (k: string) => k.startsWith("appt:");

/**
 * Reminder ladder → push decisions for one rep for one day.
 *   Due today (no push) · Due today on P1 or opp ≥ bigDealUsd → one push each at 08:00
 *   Overdue 1–3 business days → ONE grouped push at 08:00 ("3 overdue, top: Greystar — call Dave")
 *   P1/P2 overdue > 3 business days → manager escalation instead (never another push)
 *   Overdue > 14 days → auto-snooze prompt (no push)
 *   Signal on an owned account → push as soon as inside the window
 * Caps: ≤ maxPushesPerDay (3) including already sent; nothing outside the window; no weekends unless enabled.
 */
export function decidePushes(a: PushArgs): { pushes: PushDecision[]; suppressed: PushSuppression[] } {
  const st = a.settings;
  const sent = new Set(a.sent);
  const start = hhmmToMinutes(st.pushWindowStart);
  const end = hhmmToMinutes(st.pushWindowEnd);
  const clamp = (hhmm: string) => (hhmmToMinutes(hhmm) < start ? st.pushWindowStart : hhmm);

  type Cand = PushDecision & { priority: number; sortValue: number };
  const cands: Cand[] = [];

  for (const s of a.signals) {
    const sig = a.items.find((i) => i.signalId === s.id);
    if (!sig) continue;
    const c = localClock(st.timeZone, new Date(s.occurredAt));
    const at = c.date === a.today ? clamp(`${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`) : st.pushWindowStart;
    cands.push({
      key: `signal:${s.id}`,
      kind: "signal",
      at,
      dueNow: false,
      title: clip(s.accountName ? `${s.accountName}: ${s.headline}` : s.headline, 80),
      body: clip(sig.why, 120),
      itemKeys: [sig.key],
      priority: isReplySignal(s) ? 0 : 3,
      sortValue: sig.value ?? 0,
    });
  }

  const tasks = a.items.filter((i) => i.type === "task" && !i.snoozePrompt && !i.escalate);
  for (const t of tasks) {
    if (t.overdueDays !== 0) continue;
    if (!(t.icpTier === 1 || (t.value ?? 0) >= st.bigDealUsd)) continue;
    cands.push({
      key: `due:${t.taskId}`,
      kind: "due_today_big",
      at: st.ladderPushAt,
      dueNow: false,
      title: clip(t.accountName ? `${t.accountName} — ${t.title}` : t.title, 80),
      body: clip(`Due today · ${t.why}`, 120),
      itemKeys: [t.key],
      priority: 1,
      sortValue: t.value ?? 0,
    });
  }

  const overdue = tasks.filter((t) => t.overdueBusinessDays >= 1 && t.overdueBusinessDays <= st.escalateAfterBusinessDays);
  if (overdue.length) {
    const top = overdue[0];
    cands.push({
      key: `overdue:${a.today}`,
      kind: "overdue_group",
      at: st.ladderPushAt,
      dueNow: false,
      title: `${overdue.length} overdue`,
      body: clip(`${overdue.length} overdue, top: ${top.accountName ? `${top.accountName} — ` : ""}${top.title}`, 120),
      itemKeys: overdue.map((t) => t.key),
      priority: 2,
      sortValue: 0,
    });
  }

  cands.sort((x, y) => x.priority - y.priority || y.sortValue - x.sortValue || x.key.localeCompare(y.key));

  const suppressed: PushSuppression[] = [];
  if (isWeekend(a.today) && !st.weekendReminders) {
    return { pushes: [], suppressed: cands.map((c) => ({ key: c.key, reason: "weekend" })) };
  }

  const pushes: PushDecision[] = [];
  let budget = Math.max(st.maxPushesPerDay - [...sent].filter((k) => !isApptPushKey(k)).length, 0);
  const nowMin = a.clock ? a.clock.hour * 60 + a.clock.minute : null;
  for (const c of cands) {
    if (sent.has(c.key)) {
      suppressed.push({ key: c.key, reason: "already_sent" });
      continue;
    }
    if (hhmmToMinutes(c.at) >= end) {
      suppressed.push({ key: c.key, reason: "quiet_hours" });
      continue;
    }
    if (budget <= 0) {
      suppressed.push({ key: c.key, reason: "cap" });
      continue;
    }
    budget--;
    const dueNow =
      nowMin !== null && a.clock!.date === a.today && nowMin >= hhmmToMinutes(c.at) && nowMin >= start && nowMin < end;
    const { priority: _p, sortValue: _v, ...decision } = c;
    void _p;
    void _v;
    pushes.push({ ...decision, dueNow });
  }

  // Appointment reminders: `reminder_minutes` before the start. They bypass the daily cap (a booked inspection is a
  // commitment, not a nudge) but never quiet hours: a reminder that would land before the window opens moves to the
  // window start if that's still before the appointment; otherwise (or after the window closes) it's suppressed.
  for (const ap of a.appointments ?? []) {
    if (ap.allDay || ap.reminderMinutes <= 0) continue;
    const key = `appt:${ap.id}`;
    if (sent.has(key)) {
      suppressed.push({ key, reason: "already_sent" });
      continue;
    }
    const startC = localClock(st.timeZone, new Date(ap.startsAt));
    if (startC.date !== a.today) continue;
    const startMin = startC.hour * 60 + startC.minute;
    let atMin = startMin - ap.reminderMinutes;
    if (atMin < start) atMin = start;
    if (atMin >= startMin || atMin >= end) {
      suppressed.push({ key, reason: "quiet_hours" });
      continue;
    }
    const at = `${String(Math.floor(atMin / 60)).padStart(2, "0")}:${String(atMin % 60).padStart(2, "0")}`;
    const dueNow = nowMin !== null && a.clock!.date === a.today && nowMin >= atMin && nowMin < startMin && nowMin >= start && nowMin < end;
    const item = a.items.find((i) => i.appointmentId === ap.id);
    pushes.push({
      key,
      kind: "appointment",
      at,
      dueNow,
      title: clip(`${apptClock(ap.startsAt, st.timeZone)} · ${ap.title}`, 80),
      body: clip(join([ap.place, ap.buildings > 1 ? `${ap.buildings} buildings` : null]) || "Coming up", 120),
      itemKeys: item ? [item.key] : [],
    });
  }
  return { pushes, suppressed };
}
