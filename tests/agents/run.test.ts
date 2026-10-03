import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent, summarizeOutput } from "@/agents/runtime/run";
import { applyGradeCaps, grade, isWorseThan, type Rubric } from "@/agents/runtime/evaluator";
import { g1SpeedToLeadException } from "@/agents/runtime/gates";
import { fakeTransport, memoryStore, MODEL_ENV, nullDb } from "./fixtures";

const spec = { agentKey: "rep-daily-brief", tenantId: "t1", trigger: "cron" as const, subjectUserId: "u1", inputs: { x: 1 } };

describe("runAgent bookkeeping", () => {
  it("records run, ordered steps with model/tokens, proposals, grade and totals", async () => {
    const mem = memoryStore();
    const { transport } = fakeTransport(["plain", '{"ok":true}'], { input: 1000, output: 100 });
    const res = await runAgent(
      spec,
      async (ctx) => {
        const loaded = await ctx.step("load", "none", () => ({ rows: 3 }));
        const text = await ctx.step("think", "opus", async () =>
          (await ctx.llm.complete({ tier: "opus", system: "s", messages: [{ role: "user", content: "x" }] })).text,
        );
        const json = await ctx.step("check", "sonnet", async () =>
          (await ctx.llm.complete({ tier: "sonnet", system: "s", messages: [{ role: "user", content: "x" }], json: z.object({ ok: z.boolean() }) })).data,
        );
        ctx.propose({ type: "send_email", gate: "G1", payload: { to: "x" } });
        ctx.setGrade({ score: "B", flags: [], rationale: "fine" });
        return { loaded, text, json };
      },
      { db: nullDb, store: mem.store, transport, env: MODEL_ENV },
    );

    expect(res.output).toEqual({ loaded: { rows: 3 }, text: "plain", json: { ok: true } });
    expect(mem.runs).toHaveLength(1);
    expect(mem.runs[0]).toMatchObject({ agentKey: "rep-daily-brief", tenantId: "t1", subjectUserId: "u1" });
    expect(mem.steps.map((s) => [s.idx, s.name, s.tier, s.model, s.inputTokens])).toEqual([
      [0, "load", "none", null, 0],
      [1, "think", "opus", "test-opus", 1000],
      [2, "check", "sonnet", "test-sonnet", 1000],
    ]);
    const fin = mem.runs[0].finish!;
    expect(fin.status).toBe("succeeded");
    expect(fin.inputTokens).toBe(2000);
    expect(fin.outputTokens).toBe(200);
    expect(fin.costUsd).toBeCloseTo((1000 * 5 + 100 * 25 + 1000 * 3 + 100 * 15) / 1e6, 8);
    expect(fin.proposedActions).toEqual([{ type: "send_email", gate: "G1", payload: { to: "x" } }]);
    expect(fin.grade).toEqual({ score: "B", flags: [], rationale: "fine" });
    expect(fin.finishedAt).toBeTruthy();
  });

  it("logs a failed run (status failed + error + failing step) and rethrows", async () => {
    const mem = memoryStore();
    await expect(
      runAgent(
        spec,
        async (ctx) => {
          await ctx.step("ok", "none", () => 1);
          await ctx.step("boom", "none", () => {
            throw new Error("kaput");
          });
        },
        { db: nullDb, store: mem.store, transport: null, env: MODEL_ENV },
      ),
    ).rejects.toThrow("kaput");
    expect(mem.runs[0].finish).toMatchObject({ status: "failed", error: "Error: kaput" });
    expect(mem.steps[1]).toMatchObject({ name: "boom", output: { error: "Error: kaput" } });
  });

  it("without a transport, ctx.llm is unavailable and calling it throws", async () => {
    const mem = memoryStore();
    await runAgent(
      spec,
      async (ctx) => {
        expect(ctx.llm.available).toBe(false);
        expect(() => ctx.llm.complete({ tier: "opus", system: "", messages: [] })).toThrow(/ANTHROPIC_API_KEY/);
      },
      { db: nullDb, store: mem.store, transport: null, env: MODEL_ENV },
    );
    expect(mem.runs[0].finish?.status).toBe("succeeded");
  });

  it("flagForReview marks the run needs_review", async () => {
    const mem = memoryStore();
    await runAgent(spec, async (ctx) => ctx.flagForReview(), { db: nullDb, store: mem.store, transport: null });
    expect(mem.runs[0].finish?.status).toBe("needs_review");
  });

  it("truncates large step outputs", () => {
    const out = summarizeOutput({ big: "x".repeat(20_000) }) as { truncated: boolean };
    expect(out.truncated).toBe(true);
  });
});

describe("evaluator", () => {
  const rubric: Rubric = { agentKey: "a", mission: "m", checks: ["c"], never: ["n"] };
  it("grades with the sonnet tier and caps at C on hallucination_risk", async () => {
    const mem = memoryStore();
    const { transport, requests } = fakeTransport(['{"score":"A","flags":["hallucination_risk"],"rationale":"made up a name"}']);
    const g = await runAgent(spec, (ctx) => grade(ctx.llm, { output: { x: 1 }, rubric, context: { y: 2 } }), {
      db: nullDb,
      store: mem.store,
      transport,
      env: MODEL_ENV,
    });
    expect(requests[0].model).toBe("test-sonnet");
    expect(g.output.score).toBe("C");
  });
  it("orders grades", () => {
    expect(isWorseThan("D", "C")).toBe(true);
    expect(isWorseThan("C", "C")).toBe(false);
    expect(applyGradeCaps({ score: "B", flags: ["compliance_risk"], rationale: "r" }).score).toBe("C");
    expect(applyGradeCaps({ score: "D", flags: ["compliance_risk"], rationale: "r" }).score).toBe("D");
  });
});

describe("gates", () => {
  it("G1 Speed-to-Lead exception hook only fires for first responses on approved templates", () => {
    expect(g1SpeedToLeadException({ agentKey: "speed-to-lead", isFirstResponseToInbound: true, templateApproved: true })).toBe(true);
    expect(g1SpeedToLeadException({ agentKey: "speed-to-lead", isFirstResponseToInbound: true, templateApproved: false })).toBe(false);
    expect(g1SpeedToLeadException({ agentKey: "cold-outreach", isFirstResponseToInbound: true, templateApproved: true })).toBe(false);
  });
});
