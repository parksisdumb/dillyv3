import { describe, expect, it } from "vitest";
import { runRepDailyBrief, type BriefDeps } from "@/agents/rep-daily-brief/agent";
import type { BriefRow, RepContext } from "@/agents/rep-daily-brief/data";
import { CLEAR_DAY } from "@/agents/rep-daily-brief/template";
import { runRemindersForRep, runEscalationsForTenant, type ReminderDeps } from "@/agents/rep-daily-brief/reminders";
import type { TransportRequest } from "@/agents/runtime/llm";
import type { Db } from "@/agents/runtime/db";
import { fakeTransport, memoryStore, MODEL_ENV, MON, nullDb, opp, repContext, task } from "./fixtures";

const GOOD = JSON.stringify({
  one_thing: "Call Dave at Greystar on the $160K proposal — 18 days in proposal sent.",
  due: "Due: 2 follow-ups (1 overdue).",
  new: "New: nothing overnight.",
});
const gradeReply = (score: string, flags: string[] = []) => JSON.stringify({ score, flags, rationale: "checked against facts" });

function busyContext(): RepContext {
  return repContext({
    queue: [task(), task({ overdue_days: 1, due_on: "2026-10-02" })],
    opportunities: [opp({ stage: "proposal_sent", value: 160_000, daysInStage: 18, accountName: "Greystar" })],
    streak: 3,
  });
}

function harness(ctx: RepContext, replies: (string | ((r: TransportRequest) => string))[] | null) {
  const mem = memoryStore();
  const written: BriefRow[] = [];
  const fake = replies ? fakeTransport(replies) : null;
  const deps: BriefDeps = {
    db: nullDb,
    store: mem.store,
    transport: fake?.transport ?? null,
    env: MODEL_ENV,
    loader: async () => ctx,
    writer: async (_db, row) => {
      written.push(row);
    },
  };
  return { mem, written, deps, requests: fake?.requests ?? [] };
}

describe("runRepDailyBrief", () => {
  it("LLM draft graded B is published as-is; steps follow the card", async () => {
    const h = harness(busyContext(), [GOOD, gradeReply("B")]);
    const res = await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps);

    expect(res.brief.source).toBe("llm");
    expect(res.brief.headline).toContain("$160K");
    expect(res.grade?.score).toBe("B");
    expect(res.fallbackReason).toBeNull();
    expect(h.requests.map((r) => r.model)).toEqual(["test-opus", "test-sonnet"]);
    expect(h.requests[0].messages[0].content).toContain('"QUEUE_EMPTY": false');
    expect(h.mem.steps.map((s) => `${s.name}:${s.tier}`)).toEqual([
      "load-context:none",
      "rank:none",
      "write-brief:opus",
      "grade:sonnet",
      "publish:none",
    ]);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({ tenantId: "tenant-1", userId: "user-1", forDate: MON, runId: "run-1" });
    expect(h.written[0].content.lines.map((l) => l.kind)).toEqual(["one_thing", "due", "new"]);
    expect(h.written[0].queue[0].opportunityId).toBeTruthy(); // the one thing leads the queue
    expect(h.mem.runs[0].finish).toMatchObject({ status: "succeeded", grade: { score: "B" } });
    expect(h.mem.runs[0].finish!.inputTokens).toBeGreaterThan(0);
  });

  it("grade worse than C → deterministic template, grade still recorded", async () => {
    const h = harness(busyContext(), [GOOD, gradeReply("D")]);
    const res = await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps);
    expect(res.brief.source).toBe("template");
    expect(res.fallbackReason).toBe("grade_D");
    expect(h.written[0].content.source).toBe("template");
    expect(h.mem.runs[0].finish?.grade).toMatchObject({ score: "D" });
  });

  it("an F grade falls back AND flags the run for human review", async () => {
    const h = harness(busyContext(), [GOOD, gradeReply("F", ["hallucination_risk"])]);
    const res = await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps);
    expect(res.brief.source).toBe("template");
    expect(h.mem.runs[0].finish?.status).toBe("needs_review");
  });

  it("hallucination flag on a C draft still falls back", async () => {
    const h = harness(busyContext(), [GOOD, gradeReply("C", ["hallucination_risk"])]);
    expect((await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps)).brief.source).toBe("template");
  });

  it("over-long or invalid LLM output twice → template (rep never gets a bad brief)", async () => {
    const tooLong = JSON.stringify({ one_thing: "x".repeat(200), due: "Due: 2.", new: "New: none." });
    const h = harness(busyContext(), [tooLong, "not json"]);
    const res = await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps);
    expect(res.brief.source).toBe("template");
    expect(res.fallbackReason).toMatch(/^llm_failed/);
    expect(h.written).toHaveLength(1);
    expect(h.mem.runs[0].finish?.status).toBe("succeeded");
  });

  it("no ANTHROPIC_API_KEY → template brief, no LLM steps", async () => {
    const h = harness(busyContext(), null);
    const res = await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps);
    expect(res.brief.source).toBe("template");
    expect(res.fallbackReason).toBe("llm_unavailable");
    expect(res.brief.lines[1].text).toContain("Streak: 3 days");
    expect(h.mem.steps.every((s) => s.tier === "none")).toBe(true);
  });

  it("empty queue → clear-day brief without spending tokens", async () => {
    const h = harness(repContext(), [GOOD]);
    const res = await runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps);
    expect(res.brief.headline).toBe(CLEAR_DAY);
    expect(h.requests).toHaveLength(0);
  });

  it("a loader failure is logged as a failed run and rethrown (Inngest retries)", async () => {
    const h = harness(busyContext(), null);
    h.deps.loader = async () => {
      throw new Error("db down");
    };
    await expect(runRepDailyBrief({ tenantId: "tenant-1", userId: "user-1" }, h.deps)).rejects.toThrow("db down");
    expect(h.mem.runs[0].finish).toMatchObject({ status: "failed", error: "Error: db down" });
    expect(h.written).toHaveLength(0);
  });
});

/** Minimal fake supabase: records inserts, answers selects with []. */
function fakeDb() {
  const inserts: { table: string; rows: unknown }[] = [];
  const chain = (table: string): unknown => {
    const result = { data: [] as unknown[], error: null };
    const q: Record<string, unknown> = {
      insert: (rows: unknown) => {
        inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: null });
      },
      then: (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res),
    };
    for (const m of ["select", "eq", "in", "gte"]) q[m] = () => q;
    return q;
  };
  return { db: { from: chain } as unknown as Db, inserts };
}

describe("reminders + escalations", () => {
  const thu8 = new Date("2026-10-08T13:00:00Z"); // Thu 08:00 Chicago

  it("records pushes due now as reminder insights inside a logged run, then dedupes", async () => {
    const { db, inserts } = fakeDb();
    const mem = memoryStore();
    const ctx = repContext({ forDate: "2026-10-08", queue: [task({ icp_tier: 1, due_on: "2026-10-08" })] });
    let sent: string[] = [];
    const deps: ReminderDeps = { db, store: mem.store, transport: null, loader: async () => ctx, sentToday: async () => sent };
    const first = await runRemindersForRep({ tenant: ctx.tenant, userId: "user-1", now: thu8 }, deps);
    expect(first.pushes).toHaveLength(1);
    expect(first.pushes[0].kind).toBe("due_today_big");
    expect(inserts[0].table).toBe("insight");
    expect(inserts[0].rows).toEqual([expect.objectContaining({ kind: "reminder", agent_run_id: "run-1" })]);
    expect(mem.runs[0]).toMatchObject({ subjectUserId: "user-1", inputs: expect.objectContaining({ mode: "reminders" }) });

    sent = [first.pushes[0].key];
    const again = await runRemindersForRep({ tenant: ctx.tenant, userId: "user-1", now: thu8 }, deps);
    expect(again).toEqual({ runId: null, pushes: [] });
    expect(mem.runs).toHaveLength(1); // no empty runs cluttering the log
  });

  it("does nothing outside the push window", async () => {
    const { db } = fakeDb();
    const ctx = repContext({ queue: [task({ icp_tier: 1 })] });
    let loaded = false;
    const res = await runRemindersForRep(
      { tenant: ctx.tenant, userId: "user-1", now: new Date("2026-10-05T11:30:00Z") }, // 06:30 Chicago
      { db, transport: null, loader: async () => ((loaded = true), ctx) },
    );
    expect(res.pushes).toHaveLength(0);
    expect(loaded).toBe(false);
  });

  it("creates manager escalation cards for P1/P2 > 3 business days overdue", async () => {
    const { db, inserts } = fakeDb();
    const mem = memoryStore();
    const fri = new Date("2026-10-09T13:00:00Z");
    const ctx = repContext({ forDate: "2026-10-09", queue: [task({ icp_tier: 1, due_on: MON, overdue_days: 4 }), task({ icp_tier: 3, due_on: MON, overdue_days: 4 })] });
    const res = await runEscalationsForTenant({ tenant: ctx.tenant, userIds: ["user-1"], now: fri }, { db, store: mem.store, transport: null, loader: async () => ctx });
    expect(res.created).toBe(1);
    const rows = inserts.find((i) => i.table === "insight")!.rows as { kind: string; title: string }[];
    expect(rows).toEqual([expect.objectContaining({ kind: "escalation", title: "Sam Rivera: Greystar — Call Dave back" })]);
  });
});
