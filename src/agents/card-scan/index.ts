/**
 * Card scan agent: one business-card photo → contact fields, via Claude vision (sonnet tier).
 *
 * Never blocks the rep: no key / no model / timeout / bad JSON all come back as { ok: false, reason } and the form
 * stays editable. Every scan is an agent_run (cost tracking) when the run log is reachable; if it isn't (no
 * service-role key), the scan still works and only the log line is lost.
 */
import { runAgent, supabaseRunStore, type RunDeps, type RunStore } from "@/agents/runtime/run";
import { adminDb, type Db } from "@/agents/runtime/db";
import { defaultTransport, LlmJsonError } from "@/agents/runtime/llm";
import { modelFor } from "@/agents/runtime/models";
import { cardSchema, isEmptyCard, normalizeCard, type CardFields } from "@/lib/cards/card";
import { log } from "@/lib/observability/log";

export const CARD_SCAN_AGENT = "card-scan";

export type CardScanReason = "not_configured" | "unreadable" | "failed";
export type CardScanResult =
  | { ok: true; fields: CardFields; runId: string | null; costUsd: number }
  | { ok: false; reason: CardScanReason; message: string; runId: string | null };

export const CARD_MESSAGES: Record<CardScanReason, string> = {
  not_configured: "Card reading isn't switched on yet — type the details in. The card photo is saved with the contact.",
  unreadable: "Couldn't read that card. Try again in better light, or type it in.",
  failed: "Card reading didn't answer — type the details in. The card photo is saved with the contact.",
};

const SYSTEM = `You read business cards for commercial roofing sales reps.
Return the person's details exactly as printed on the card. Rules:
- If the image is not a business card, set is_business_card to false and every other field to null.
- first_name / last_name: the person, not the company. Keep capitalization as printed.
- phone: the main office / direct line. mobile: a number labelled cell, mobile, m or c.
- email and website: as printed, no "mailto:".
- address: one line, street to ZIP.
- Use null for anything not on the card. Never guess or invent.`;

export type CardScanInput = { tenantId: string; userId: string; image: { data: string; mediaType: "image/jpeg" } };

async function serviceDb(): Promise<Db | null> {
  try {
    return await adminDb();
  } catch (err) {
    log.warn("card-scan:no-run-log", { err });
    return null;
  }
}

/** A store that keeps nothing: the scan must work even when agent_run can't be written. */
const nullStore: RunStore = {
  createRun: async () => "00000000-0000-0000-0000-000000000000",
  addStep: async () => {},
  finishRun: async () => {},
};

export async function scanCard(input: CardScanInput, deps: RunDeps = {}): Promise<CardScanResult> {
  const env = deps.env ?? process.env;
  const transport = deps.transport === undefined ? defaultTransport(env) : deps.transport;
  let configured = !!transport;
  try {
    modelFor("sonnet", env);
  } catch {
    configured = false;
  }
  const db = deps.db ?? (deps.store ? null : await serviceDb());
  const realStore = deps.store ?? (db ? supabaseRunStore(db) : null);
  // A hiccup writing the run log must not cost the rep the scan: degrade to an unlogged run.
  let logged = !!realStore;
  const store: RunStore = realStore
    ? {
        createRun: async (spec) => {
          try {
            return await realStore.createRun(spec);
          } catch (err) {
            logged = false;
            log.warn("card-scan:run-log-failed", { tenant: input.tenantId, err });
            return nullStore.createRun(spec);
          }
        },
        addStep: async (st) => (logged ? realStore.addStep(st) : undefined),
        finishRun: async (id, fin) => {
          if (logged) await realStore.finishRun(id, fin).catch((err) => log.warn("card-scan:run-log-failed", { tenant: input.tenantId, err }));
        },
      }
    : nullStore;
  const runIdOf = (id: string) => (logged ? id : null);

  try {
    const res = await runAgent(
      { agentKey: CARD_SCAN_AGENT, tenantId: input.tenantId, trigger: "human", subjectUserId: input.userId, inputs: { kind: "business_card", bytes: Math.round((input.image.data.length * 3) / 4) } },
      async (ctx) => {
        if (!configured || !ctx.llm.available) return { outcome: "not_configured" as const };
        const out = await ctx.step(
          "read-card",
          "sonnet",
          () =>
            ctx.llm.complete({
              tier: "sonnet",
              system: SYSTEM,
              maxTokens: 600,
              json: cardSchema,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "image", mediaType: input.image.mediaType, data: input.image.data },
                    { type: "text", text: "Read this business card." },
                  ],
                },
              ],
            }),
          { summarize: (r) => ({ attempts: r.attempts, fields: Object.keys(r.data).filter((k) => r.data[k as keyof typeof r.data] != null) }) },
        );
        if (out.data.is_business_card === false) return { outcome: "unreadable" as const };
        const fields = normalizeCard(out.data);
        return isEmptyCard(fields) ? { outcome: "unreadable" as const } : { outcome: "ok" as const, fields };
      },
      // The scan itself never touches the database; without a service role the run just isn't logged.
      { ...deps, db: db ?? ({} as Db), store, transport, env },
    );
    const o = res.output;
    if (o.outcome === "ok") return { ok: true, fields: o.fields, runId: runIdOf(res.runId), costUsd: res.usage.costUsd };
    return { ok: false, reason: o.outcome, message: CARD_MESSAGES[o.outcome], runId: runIdOf(res.runId) };
  } catch (err) {
    log.warn("card-scan:failed", { tenant: input.tenantId, user: input.userId, err });
    const reason: CardScanReason = err instanceof LlmJsonError ? "unreadable" : "failed";
    return { ok: false, reason, message: CARD_MESSAGES[reason], runId: null };
  }
}
