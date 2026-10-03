import { settingsFromTenant, type BriefSettings, type NewSignal, type OpenOpportunity, type QueueRow } from "@/agents/rep-daily-brief/rank";
import type { RepContext } from "@/agents/rep-daily-brief/data";
import type { LlmTransport, TransportRequest } from "@/agents/runtime/llm";
import type { RunFinish, RunSpec, RunStore, StepRecord } from "@/agents/runtime/run";
import type { Db } from "@/agents/runtime/db";

export const TZ = "America/Chicago";
// 2026-10-05 is a Monday.
export const MON = "2026-10-05";

export function settings(over: Partial<BriefSettings> = {}): BriefSettings {
  return { ...settingsFromTenant(TZ, {}), ...over };
}

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function task(over: Partial<QueueRow> = {}): QueueRow {
  return {
    item_type: "task",
    task_id: id("task"),
    account_id: id("acct"),
    contact_id: null,
    opportunity_id: null,
    property_id: null,
    title: "Call Dave back",
    reason: null,
    due_on: MON,
    overdue_days: 0,
    score: 50,
    account_name: "Greystar",
    contact_name: "Dave Lopez",
    phone: null,
    email: null,
    icp_tier: 3,
    ...over,
  };
}

export function reengage(over: Partial<QueueRow> = {}): QueueRow {
  return task({
    item_type: "reengage",
    task_id: null,
    title: "Re-engage Cushman",
    reason: "P1 quiet 20 days (threshold 14)",
    due_on: null,
    overdue_days: null,
    account_name: "Cushman",
    icp_tier: 1,
    score: 76,
    ...over,
  });
}

export function opp(over: Partial<OpenOpportunity> = {}): OpenOpportunity {
  return {
    id: id("opp"),
    name: "Roof replacement",
    accountId: id("acct"),
    accountName: "Brookfield",
    value: 40_000,
    stage: "inspection_complete",
    daysInStage: 2,
    nextStep: null,
    nextStepDue: null,
    ...over,
  };
}

export function signal(over: Partial<NewSignal> = {}): NewSignal {
  return {
    id: id("sig"),
    kind: "permit",
    headline: "Re-roof permit filed",
    accountId: id("acct"),
    accountName: "Hines",
    occurredAt: "2026-10-05T12:00:00Z", // 07:00 Chicago
    weight: 1,
    ...over,
  };
}

export function repContext(over: Partial<RepContext> = {}): RepContext {
  return {
    tenant: { id: "tenant-1", name: "Fox", timezone: TZ, settings: settings(), briefRoles: ["rep"] },
    userId: "user-1",
    repName: "Sam Rivera",
    forDate: MON,
    queue: [],
    opportunities: [],
    signals: [],
    doNotPursueAccountIds: [],
    newAssignments: 0,
    yesterday: null,
    streak: 0,
    signalsSince: "2026-10-04T11:00:00Z",
    ...over,
  };
}

/** In-memory RunStore capturing everything runAgent writes. */
export function memoryStore() {
  const runs: (RunSpec & { id: string; finish?: RunFinish })[] = [];
  const steps: StepRecord[] = [];
  const store: RunStore = {
    async createRun(spec) {
      const rid = `run-${runs.length + 1}`;
      runs.push({ ...spec, id: rid });
      return rid;
    },
    async addStep(s) {
      steps.push(s);
    },
    async finishRun(rid, fin) {
      runs.find((r) => r.id === rid)!.finish = fin;
    },
  };
  return { store, runs, steps };
}

/** Scripted transport: returns replies in order; records requests. */
export function fakeTransport(replies: (string | ((req: TransportRequest) => string))[], tokens = { input: 100, output: 20 }) {
  const requests: TransportRequest[] = [];
  let i = 0;
  const transport: LlmTransport = async (req) => {
    requests.push(req);
    const r = replies[Math.min(i++, replies.length - 1)];
    return { text: typeof r === "function" ? r(req) : r, inputTokens: tokens.input, outputTokens: tokens.output };
  };
  return { transport, requests };
}

export const MODEL_ENV = {
  DILLY_MODEL_OPUS: "test-opus",
  DILLY_MODEL_SONNET: "test-sonnet",
  DILLY_MODEL_HAIKU: "test-haiku",
};

/** Agents under test never touch the db directly when loader/writer/store are injected. */
export const nullDb = {} as Db;
