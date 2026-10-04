/**
 * Rep Daily Brief & Reminders (04-POD-3 §3.12) — the brief, end to end, for one (tenant, rep, date).
 *
 *   1 load-context (none) → 2 rank (none) → 3 write-brief (opus, zod JSON) → 4 grade (sonnet Evaluator)
 *   → fallback to the deterministic template when the LLM is absent/failed or the grade is worse than C
 *   → 5 publish (upsert public.brief)
 */
import { z } from "zod";
import { grade as gradeOutput, isWorseThan, type Grade, type Rubric } from "../runtime/evaluator";
import { runAgent, type AgentContext, type RunDeps, type RunTrigger } from "../runtime/run";
import type { Db } from "../runtime/db";
import { loadRepContext, writeBrief, type BriefRow, type RepContext } from "./data";
import { MAX_LINE, rank, type Ranked } from "./rank";
import { templateBrief, type BriefContent } from "./template";

export const AGENT_KEY = "rep-daily-brief";

export const BriefDraftSchema = z.object({
  one_thing: z.string().trim().min(1).max(MAX_LINE),
  due: z.string().trim().min(1).max(MAX_LINE),
  new: z.string().trim().min(1).max(MAX_LINE),
});
export type BriefDraft = z.infer<typeof BriefDraftSchema>;

/** The card is the rubric. */
export const BRIEF_RUBRIC: Rubric = {
  agentKey: AGENT_KEY,
  mission:
    "Three-line 06:00 brief that tells a commercial roofing rep the one thing that matters today, what is due, and what is new.",
  checks: [
    "one_thing names the account (or deal) and the concrete ask, and matches the ONE_THING candidate in context",
    "due uses the DUE counts exactly (follow-ups, overdue, first touches, re-engage, deal next steps); zero counts omitted",
    "new uses the NEW counts exactly (replies, signals, accounts assigned) or says nothing came in",
    "plain field language a roofing rep would use; each line 140 characters or fewer",
    "when the queue is empty, says the day is clear and points the rep to the field plan",
  ],
  never: [
    "invent a name, account, dollar amount, date, count or event that is not in CONTEXT",
    "greetings, motivation, filler, emojis or exclamation marks",
    "contradict the counts in CONTEXT",
    "a brief with zero actionable direction",
  ],
};

const SYSTEM = `You write the 06:00 three-line brief for a commercial roofing sales rep. It is read on a phone in a truck.
Return three fields:
- one_thing: the single highest-value action today. Build it from ONE_THING in FACTS: name the account or deal and the ask.
- due: start with "Due:". Use the DUE counts exactly; leave out zeros. If DUE.appointments > 0, lead with them and the first one's time and place (DUE.firstMeetingAt).
- new: start with "New:". Use the NEW counts exactly; if all are zero write "New: nothing overnight."
Rules: plain field language; no greeting, no motivation, no emojis, no exclamation marks; each field 140 characters or fewer;
use only names, numbers and facts that appear in FACTS — never invent or estimate anything.
If QUEUE_EMPTY is true, one_thing must say the day is clear and to work the field plan.`;

export function briefFacts(ctx: RepContext, r: Ranked) {
  return {
    date: ctx.forDate,
    rep: ctx.repName?.split(" ")[0] ?? null,
    QUEUE_EMPTY: r.isEmpty,
    ONE_THING: r.oneThing ? { kind: r.oneThing.kind, suggested: r.oneThing.text } : null,
    DUE: r.due,
    NEW: r.new,
    top_queue: r.items.slice(0, 6).map((i) => ({
      title: i.title,
      why: i.why,
      account: i.accountName,
      contact: i.contactName,
      value_usd: i.value,
      overdue_days: i.overdueDays,
    })),
    streak_days: ctx.streak,
    yesterday: ctx.yesterday ? { cleared: ctx.yesterday.cleared, touches: ctx.yesterday.touches } : null,
  };
}

function fromDraft(d: BriefDraft): BriefContent {
  return {
    headline: d.one_thing,
    lines: [
      { kind: "one_thing", text: d.one_thing },
      { kind: "due", text: d.due },
      { kind: "new", text: d.new },
    ],
    source: "llm",
  };
}

export interface BriefDeps extends RunDeps {
  loader?: (db: Db, tenantId: string, userId: string, forDate: string | undefined, now: Date) => Promise<RepContext>;
  writer?: (db: Db, row: BriefRow) => Promise<void>;
}

export interface BriefArgs {
  tenantId: string;
  userId: string;
  forDate?: string;
  trigger?: RunTrigger;
  workItemId?: string | null;
}

export interface BriefResult {
  runId: string;
  forDate: string;
  brief: BriefContent;
  grade: Grade | null;
  fallbackReason: string | null;
  ranked: Pick<Ranked, "oneThing" | "due" | "new" | "escalations" | "snoozePrompts">;
}

/** Grade worse than C, or any hallucination flag, never reaches a rep. */
export function acceptDraft(g: Grade): boolean {
  return !isWorseThan(g.score, "C") && !g.flags.includes("hallucination_risk");
}

async function draftWithLlm(ctx: AgentContext, rc: RepContext, r: Ranked) {
  const facts = briefFacts(rc, r);
  const draft = await ctx.step(
    "write-brief",
    "opus",
    async () => {
      try {
        const res = await ctx.llm.complete({
          tier: "opus",
          system: SYSTEM,
          messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 1)}` }],
          maxTokens: 400,
          json: BriefDraftSchema,
        });
        return { draft: res.data, attempts: res.attempts, error: null as string | null };
      } catch (e) {
        return { draft: null, attempts: 2, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
  if (!draft.draft) return { content: null, grade: null, reason: `llm_failed: ${draft.error}` };

  const g = await ctx.step("grade", "sonnet", async () => {
    try {
      return await gradeOutput(ctx.llm, { output: draft.draft, rubric: BRIEF_RUBRIC, context: facts });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  if ("error" in g) return { content: null, grade: null, reason: `grade_failed: ${g.error}` };
  if (!acceptDraft(g)) return { content: null, grade: g, reason: `grade_${g.score}${g.flags.length ? `:${g.flags.join(",")}` : ""}` };
  return { content: fromDraft(draft.draft), grade: g, reason: null };
}

export async function runRepDailyBrief(args: BriefArgs, deps: BriefDeps = {}): Promise<BriefResult> {
  const loader = deps.loader ?? loadRepContext;
  const writer = deps.writer ?? writeBrief;
  const now = deps.now ?? (() => new Date());

  const { output } = await runAgent(
    {
      agentKey: AGENT_KEY,
      tenantId: args.tenantId,
      trigger: args.trigger ?? "cron",
      subjectUserId: args.userId,
      inputs: { mode: "brief", userId: args.userId, forDate: args.forDate ?? null },
      workItemId: args.workItemId ?? null,
    },
    async (ctx): Promise<BriefResult> => {
      const rc = await ctx.step("load-context", "none", () => loader(ctx.db, args.tenantId, args.userId, args.forDate, now()), {
        summarize: (c) => ({
          forDate: c.forDate,
          queue: c.queue.length,
          opportunities: c.opportunities.length,
          signals: c.signals.length,
          newAssignments: c.newAssignments,
          streak: c.streak,
          signalsSince: c.signalsSince,
        }),
      });

      const ranked = await ctx.step(
        "rank",
        "none",
        () =>
          rank({
            today: rc.forDate,
            queue: rc.queue,
            opportunities: rc.opportunities,
            signals: rc.signals,
            settings: rc.tenant.settings,
            doNotPursueAccountIds: rc.doNotPursueAccountIds,
            extras: { newAssignments: rc.newAssignments },
            appointments: rc.appointments,
          }),
        {
          summarize: (r) => ({
            oneThing: r.oneThing,
            due: r.due,
            new: r.new,
            escalations: r.escalations.length,
            snoozePrompts: r.snoozePrompts.length,
            top: r.items.slice(0, 10).map((i) => ({ key: i.key, score: i.score, why: i.why })),
          }),
        },
      );

      let content: BriefContent | null = null;
      let grade: Grade | null = null;
      let fallbackReason: string | null = null;
      if (ranked.isEmpty) {
        fallbackReason = "empty_queue";
        await ctx.step("write-brief", "none", () => ({ skipped: "empty queue → clear-day template" }));
      } else if (!ctx.llm.available) {
        fallbackReason = "llm_unavailable";
        await ctx.step("write-brief", "none", () => ({ skipped: "ANTHROPIC_API_KEY not set → template" }));
      } else {
        const res = await draftWithLlm(ctx, rc, ranked);
        content = res.content;
        grade = res.grade;
        fallbackReason = res.reason;
      }
      if (grade) {
        ctx.setGrade(grade);
        if (grade.score === "F") ctx.flagForReview(); // F escalates to a human; the rep still gets the template
      }
      const brief = content ?? templateBrief(ranked, { streak: rc.streak });

      await ctx.step("publish", "none", async () => {
        await writer(ctx.db, {
          tenantId: args.tenantId,
          userId: args.userId,
          forDate: rc.forDate,
          content: brief,
          queue: ranked.items,
          runId: ctx.runId,
        });
        return { forDate: rc.forDate, source: brief.source, headline: brief.headline };
      });

      return {
        runId: ctx.runId,
        forDate: rc.forDate,
        brief,
        grade,
        fallbackReason,
        ranked: {
          oneThing: ranked.oneThing,
          due: ranked.due,
          new: ranked.new,
          escalations: ranked.escalations,
          snoozePrompts: ranked.snoozePrompts,
        },
      };
    },
    deps,
  );
  return output;
}
