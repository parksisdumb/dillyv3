/**
 * runAgent — the run envelope (§5) every agent conforms to.
 *
 *   agent_run (status running) → ctx.step(...) × N → agent_step rows → outputs / proposed_actions / grade / totals
 *
 * A failed run is never thrown away: it is finished with status 'failed' + error, then the error is rethrown
 * so the caller (Inngest) can retry — each attempt is its own logged run.
 */
import { adminDb, must, mustRow, toJson, type Db, type Json } from "./db";
import { addUsage, defaultTransport, Llm, LlmUnavailableError, type LlmTransport, type LlmUsage } from "./llm";
import { modelFor, type EnvSource, type StepTier } from "./models";
import type { Gate } from "./gates";
import type { Grade } from "./evaluator";

export type RunTrigger = "cron" | "signal" | "human" | "agent" | "event";

export interface RunSpec {
  agentKey: string;
  tenantId: string;
  trigger: RunTrigger;
  subjectUserId?: string | null;
  segmentId?: string | null;
  inputs: Record<string, unknown>;
  workItemId?: string | null;
}

export interface ProposedAction {
  type: string;
  gate?: Gate;
  summary?: string;
  payload: Record<string, unknown>;
}

export interface StepRecord {
  runId: string;
  idx: number;
  name: string;
  tier: StepTier;
  model: string | null;
  output: Json;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface RunFinish {
  status: "succeeded" | "failed" | "needs_review";
  outputs: Json;
  proposedActions: Json;
  grade: Json | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  finishedAt: string;
}

/** Persistence for the run log. Supabase in production; in-memory in tests. */
export interface RunStore {
  createRun(spec: RunSpec): Promise<string>;
  addStep(step: StepRecord): Promise<void>;
  finishRun(runId: string, fin: RunFinish): Promise<void>;
  setWorkItemStatus?(workItemId: string, status: "running" | "done" | "failed"): Promise<void>;
}

export function supabaseRunStore(db: Db): RunStore {
  return {
    async createRun(spec) {
      const row = mustRow(
        await db
          .from("agent_run")
          .insert({
            tenant_id: spec.tenantId,
            agent_key: spec.agentKey,
            trigger: spec.trigger,
            subject_user_id: spec.subjectUserId ?? null,
            segment_id: spec.segmentId ?? null,
            work_item_id: spec.workItemId ?? null,
            inputs: toJson(spec.inputs),
            status: "running",
          })
          .select("id")
          .single(),
        "create agent_run",
      );
      return row.id;
    },
    async addStep(s) {
      must(
        await db.from("agent_step").insert({
          run_id: s.runId,
          idx: s.idx,
          name: s.name,
          tier: s.tier,
          model: s.model,
          output: s.output,
          input_tokens: s.inputTokens,
          output_tokens: s.outputTokens,
          duration_ms: s.durationMs,
        }),
        "insert agent_step",
      );
    },
    async finishRun(runId, f) {
      must(
        await db
          .from("agent_run")
          .update({
            status: f.status,
            outputs: f.outputs,
            proposed_actions: f.proposedActions,
            grade: f.grade,
            error: f.error,
            input_tokens: f.inputTokens,
            output_tokens: f.outputTokens,
            cost_usd: Math.round(f.costUsd * 10_000) / 10_000,
            finished_at: f.finishedAt,
          })
          .eq("id", runId),
        "finish agent_run",
      );
    },
    async setWorkItemStatus(id, status) {
      must(await db.from("work_item").update({ status }).eq("id", id), "update work_item");
    },
  };
}

/** The LLM handle bound to a run: same API as Llm, plus `available`. */
export interface RunLlm {
  readonly available: boolean;
  complete: Llm["complete"];
}

export interface AgentContext {
  runId: string;
  spec: RunSpec;
  db: Db;
  llm: RunLlm;
  /** Run a named step; records an agent_step row with model, output summary, tokens, duration. */
  step<T>(name: string, tier: StepTier, fn: () => Promise<T> | T, opts?: { summarize?: (v: T) => unknown }): Promise<T>;
  propose(action: ProposedAction): void;
  setGrade(grade: Grade): void;
  /** Mark the run as needing human review instead of succeeded (e.g. Evaluator F). */
  flagForReview(): void;
}

export interface RunDeps {
  db?: Db;
  store?: RunStore;
  /** `null` = force no-LLM mode. `undefined` = from ANTHROPIC_API_KEY. */
  transport?: LlmTransport | null;
  env?: EnvSource;
  now?: () => Date;
}

export interface RunResult<T> {
  runId: string;
  output: T;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

const MAX_SUMMARY_CHARS = 8_000;

/** Keep agent_step.output small: JSON-safe, truncated past ~8KB. */
export function summarizeOutput(v: unknown): Json {
  if (v === undefined || v === null) return null;
  let json: Json;
  try {
    json = toJson(v);
  } catch {
    return { summary: String(v).slice(0, 500) };
  }
  const s = JSON.stringify(json);
  if (s.length <= MAX_SUMMARY_CHARS) return json;
  return { truncated: true, chars: s.length, preview: s.slice(0, MAX_SUMMARY_CHARS) };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export async function runAgent<T>(
  spec: RunSpec,
  fn: (ctx: AgentContext) => Promise<T>,
  deps: RunDeps = {},
): Promise<RunResult<T>> {
  const db = deps.db ?? (await adminDb());
  const store = deps.store ?? supabaseRunStore(db);
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const transport = deps.transport === undefined ? defaultTransport(env) : deps.transport;

  const runId = await store.createRun(spec);
  if (spec.workItemId && store.setWorkItemStatus) await store.setWorkItemStatus(spec.workItemId, "running");

  let total: LlmUsage | null = null;
  let stepUsage: { input: number; output: number } = { input: 0, output: 0 };
  const proposed: ProposedAction[] = [];
  let grade: Grade | null = null;
  let review = false;
  let idx = 0;

  const onUsage = (u: LlmUsage) => {
    total = total ? addUsage(total, u) : u;
    stepUsage.input += u.inputTokens;
    stepUsage.output += u.outputTokens;
  };
  const llmImpl = transport ? new Llm(transport, env, onUsage) : null;
  const llm: RunLlm = {
    available: llmImpl !== null,
    complete: ((opts: Parameters<Llm["complete"]>[0]) => {
      if (!llmImpl) throw new LlmUnavailableError();
      return llmImpl.complete(opts);
    }) as Llm["complete"],
  };

  const ctx: AgentContext = {
    runId,
    spec,
    db,
    llm,
    // Steps are expected to run sequentially; token attribution uses a per-step counter.
    async step(name, tier, stepFn, opts) {
      const myIdx = idx++;
      stepUsage = { input: 0, output: 0 };
      const started = Date.now();
      let model: string | null = null;
      if (tier !== "none") {
        try {
          model = modelFor(tier, env);
        } catch {
          model = null; // recorded as unknown; the LLM call itself will raise if it is actually used
        }
      }
      const record = async (output: Json) => {
        try {
          await store.addStep({
            runId,
            idx: myIdx,
            name,
            tier,
            model,
            output,
            inputTokens: stepUsage.input,
            outputTokens: stepUsage.output,
            durationMs: Date.now() - started,
          });
        } catch (e) {
          // Logging must never take down the agent; the run row still carries totals.
          console.error(`[agent:${spec.agentKey}] failed to record step ${name}:`, e);
        }
      };
      try {
        const value = await stepFn();
        await record(summarizeOutput(opts?.summarize ? opts.summarize(value) : value));
        return value;
      } catch (e) {
        await record({ error: errorMessage(e) });
        throw e;
      }
    },
    propose(action) {
      proposed.push(action);
    },
    setGrade(g) {
      grade = g;
    },
    flagForReview() {
      review = true;
    },
  };

  const totals = () => {
    const t = total as LlmUsage | null;
    return { inputTokens: t?.inputTokens ?? 0, outputTokens: t?.outputTokens ?? 0, costUsd: t?.costUsd ?? 0 };
  };

  try {
    const output = await fn(ctx);
    const t = totals();
    await store.finishRun(runId, {
      status: review ? "needs_review" : "succeeded",
      outputs: summarizeOutput(output) ?? {},
      proposedActions: toJson(proposed),
      grade: grade ? toJson(grade) : null,
      error: null,
      ...t,
      finishedAt: now().toISOString(),
    });
    if (spec.workItemId && store.setWorkItemStatus) await store.setWorkItemStatus(spec.workItemId, "done");
    return { runId, output, usage: t };
  } catch (e) {
    const t = totals();
    try {
      await store.finishRun(runId, {
        status: "failed",
        outputs: {},
        proposedActions: toJson(proposed),
        grade: grade ? toJson(grade) : null,
        error: errorMessage(e),
        ...t,
        finishedAt: now().toISOString(),
      });
      if (spec.workItemId && store.setWorkItemStatus) await store.setWorkItemStatus(spec.workItemId, "failed");
    } catch (logErr) {
      console.error(`[agent:${spec.agentKey}] failed to log failed run ${runId}:`, logErr);
    }
    throw e;
  }
}
