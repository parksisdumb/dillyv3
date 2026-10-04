/**
 * Reminder ladder + manager escalations (04-POD-3 §3.12), driven by rank.ts.
 *
 * Decisions are recorded as `insight` rows (kind 'reminder' / 'escalation') linked to an agent_run whose
 * subject_user_id is the rep, then delivered by Web Push to the rep's devices (src/lib/push) when VAPID keys are
 * configured. Without them, delivery falls back to record-only.
 */
import { hhmmToMinutes, isWeekend, localClock } from "../runtime/clock";
import { must, type Db } from "../runtime/db";
import { runAgent, type RunDeps } from "../runtime/run";
import { AGENT_KEY } from "./agent";
import { loadRepContext, type RepContext, type TenantInfo } from "./data";
import { rank, type BriefSettings, type Escalation, type PushDecision } from "./rank";
import { notificationFor, type PushPayload } from "@/lib/push/copy";
import { defaultPushSender } from "@/lib/push/sender";

/**
 * Delivery for one decided push. Called once per push, after the insight rows are written.
 * Must be idempotent on push.key (Web Push: the notification tag is the key, so a resend replaces itself).
 * Default: Web Push (src/lib/push/sender.ts) when VAPID env is set, else record-only.
 */
export interface PushSender {
  send(args: {
    tenantId: string;
    userId: string;
    push: PushDecision;
    /** Device copy + the exact screen to open (built from the ranked items). */
    notification?: PushPayload;
  }): Promise<{ delivered: boolean; channel: string; devices?: number; sent?: number; failed?: number; disabled?: number }>;
}

/** v1 default: record only, deliver nothing. */
export const recordOnlySender: PushSender = {
  async send() {
    return { delivered: false, channel: "none" };
  },
};

export interface ReminderDeps extends RunDeps {
  db: Db;
  loader?: typeof loadRepContext;
  sender?: PushSender;
  sentToday?: (db: Db, tenantId: string, userId: string, forDate: string) => Promise<string[]>;
}

/** True when pushes may go out right now for this tenant (window + weekend rule). */
export function inPushWindow(st: BriefSettings, now: Date): boolean {
  const c = localClock(st.timeZone, now);
  if (isWeekend(c.date) && !st.weekendReminders) return false;
  const m = c.hour * 60 + c.minute;
  return m >= hhmmToMinutes(st.pushWindowStart) && m < hhmmToMinutes(st.pushWindowEnd);
}

/** Push keys already decided today for this rep, read back from prior reminder runs' outputs. */
export async function pushKeysSentToday(db: Db, tenantId: string, userId: string, forDate: string): Promise<string[]> {
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const rows = must(
    await db
      .from("agent_run")
      .select("outputs")
      .eq("tenant_id", tenantId)
      .eq("agent_key", AGENT_KEY)
      .eq("subject_user_id", userId)
      .eq("status", "succeeded")
      .eq("inputs->>mode", "reminders")
      .gte("started_at", since),
    "load reminder runs",
  );
  const keys: string[] = [];
  for (const r of rows ?? []) {
    const o = r.outputs as { forDate?: string; pushes?: { key?: string }[] } | null;
    if (o?.forDate !== forDate) continue;
    for (const p of o.pushes ?? []) if (p.key) keys.push(p.key);
  }
  return keys;
}

function rankFor(rc: RepContext, extra: Partial<Parameters<typeof rank>[0]> = {}) {
  return rank({
    today: rc.forDate,
    queue: rc.queue,
    opportunities: rc.opportunities,
    signals: rc.signals,
    settings: rc.tenant.settings,
    doNotPursueAccountIds: rc.doNotPursueAccountIds,
    extras: { newAssignments: rc.newAssignments },
    appointments: rc.appointments,
    ...extra,
  });
}

/** Decide and record the pushes due now for one rep. Creates an agent_run only when something is due. */
export async function runRemindersForRep(
  args: { tenant: TenantInfo; userId: string; now?: Date },
  deps: ReminderDeps,
): Promise<{ runId: string | null; pushes: PushDecision[] }> {
  const now = args.now ?? new Date();
  if (!inPushWindow(args.tenant.settings, now)) return { runId: null, pushes: [] };
  const loader = deps.loader ?? loadRepContext;
  const clock = localClock(args.tenant.timezone, now);

  const rc = await loader(deps.db, args.tenant.id, args.userId, clock.date, now);
  const sent = await (deps.sentToday ?? pushKeysSentToday)(deps.db, args.tenant.id, args.userId, clock.date);
  const r = rankFor(rc, { clock, pushesSentToday: sent });
  const due = r.pushes.filter((p) => p.dueNow);
  if (!due.length) return { runId: null, pushes: [] };
  const sender = deps.sender ?? (await defaultPushSender(deps.db)) ?? recordOnlySender;
  const items = new Map(r.items.map((i) => [i.key, i]));

  const { runId } = await runAgent(
    {
      agentKey: AGENT_KEY,
      tenantId: args.tenant.id,
      trigger: "cron",
      subjectUserId: args.userId,
      inputs: { mode: "reminders", forDate: clock.date, localTime: `${clock.hour}:${clock.minute}`, alreadySent: sent },
    },
    async (ctx) => {
      await ctx.step("record-reminders", "none", async () => {
        must(
          await ctx.db.from("insight").insert(
            due.map((p) => ({
              tenant_id: args.tenant.id,
              agent_run_id: ctx.runId,
              kind: "reminder",
              title: p.title,
              body: p.body,
              recommended_action:
                p.kind === "overdue_group" ? "Open Today and clear overdue follow-ups" : p.kind === "appointment" ? "Head to the appointment" : "Open Today",
            })),
          ),
          "insert reminder insights",
        );
        const results = [];
        for (const push of due) {
          const notification = notificationFor(push, items);
          try {
            results.push({ key: push.key, url: notification.url, ...(await sender.send({ tenantId: args.tenant.id, userId: args.userId, push, notification })) });
          } catch (err) {
            // Delivery trouble never loses the recorded reminder; it shows up in the step output instead.
            results.push({ key: push.key, url: notification.url, delivered: false, channel: "error", error: err instanceof Error ? err.message : String(err) });
          }
        }
        return { recorded: due.length, results, suppressed: r.suppressedPushes };
      });
      return { mode: "reminders", forDate: clock.date, pushes: due };
    },
    deps,
  );
  return { runId, pushes: due };
}

export function escalationTitle(repName: string | null, e: Escalation): string {
  return `${repName ?? "Rep"}: ${e.accountName ? `${e.accountName} — ` : ""}${e.title}`.slice(0, 200);
}

/**
 * Manager escalation cards: P1/P2 tasks overdue > 3 business days, one card per task while open.
 * Weekdays only. Returns the number of new cards.
 */
export async function runEscalationsForTenant(
  args: { tenant: TenantInfo; userIds: string[]; now?: Date },
  deps: ReminderDeps,
): Promise<{ runId: string | null; created: number }> {
  const now = args.now ?? new Date();
  const loader = deps.loader ?? loadRepContext;
  const today = localClock(args.tenant.timezone, now).date;
  if (isWeekend(today)) return { runId: null, created: 0 };

  const cards: { title: string; body: string; userId: string; taskId: string }[] = [];
  for (const userId of args.userIds) {
    const rc = await loader(deps.db, args.tenant.id, userId, today, now);
    for (const e of rankFor(rc).escalations) {
      cards.push({
        title: escalationTitle(rc.repName, e),
        body: `P${e.icpTier} follow-up overdue ${e.overdueBusinessDays} business days (due ${e.dueOn}). Rep has had it in the queue since then.`,
        userId,
        taskId: e.taskId,
      });
    }
  }
  if (!cards.length) return { runId: null, created: 0 };

  const open = must(
    await deps.db
      .from("insight")
      .select("title")
      .eq("tenant_id", args.tenant.id)
      .eq("kind", "escalation")
      .eq("status", "open")
      .in(
        "title",
        cards.map((c) => c.title),
      ),
    "load open escalations",
  );
  const existing = new Set((open ?? []).map((o) => o.title));
  const fresh = cards.filter((c) => !existing.has(c.title));
  if (!fresh.length) return { runId: null, created: 0 };

  const { runId } = await runAgent(
    { agentKey: AGENT_KEY, tenantId: args.tenant.id, trigger: "cron", inputs: { mode: "escalations", forDate: today } },
    async (ctx) => {
      await ctx.step("record-escalations", "none", async () => {
        must(
          await ctx.db.from("insight").insert(
            fresh.map((c) => ({
              tenant_id: args.tenant.id,
              agent_run_id: ctx.runId,
              kind: "escalation",
              title: c.title,
              body: c.body,
              recommended_action: "Check in with the rep: done elsewhere, reschedule, or reassign",
            })),
          ),
          "insert escalation insights",
        );
        return { created: fresh.length };
      });
      return { mode: "escalations", forDate: today, escalations: fresh };
    },
    deps,
  );
  return { runId, created: fresh.length };
}
