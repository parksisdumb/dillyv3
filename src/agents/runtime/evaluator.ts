/**
 * Evaluator v1 (Pod 0): grade an agent output A–F against that agent's rubric, using the sonnet tier.
 * Each agent module owns its rubric (the card is the rubric).
 */
import { z } from "zod";
import type { RunLlm } from "./run";

export const GRADES = ["A", "B", "C", "D", "F"] as const;
export type GradeScore = (typeof GRADES)[number];

export const GradeSchema = z.object({
  score: z.enum(GRADES),
  flags: z.array(z.string()),
  rationale: z.string().min(1).max(1200),
});
export type Grade = z.infer<typeof GradeSchema>;

export interface Rubric {
  agentKey: string;
  mission: string;
  /** What a good output must do. */
  checks: string[];
  /** The agent's "never" list, run as assertions. */
  never: string[];
}

/** Flags that cap a grade at C (Evaluator guardrail). */
export const CAPPING_FLAGS = ["hallucination_risk", "compliance_risk"] as const;

export function gradeRank(s: GradeScore): number {
  return GRADES.indexOf(s);
}

/** True when `a` is strictly worse than `b` (e.g. D worse than C). */
export function isWorseThan(a: GradeScore, b: GradeScore): boolean {
  return gradeRank(a) > gradeRank(b);
}

export function applyGradeCaps(g: Grade): Grade {
  const capped = g.flags.some((f) => (CAPPING_FLAGS as readonly string[]).includes(f));
  if (capped && gradeRank(g.score) < gradeRank("C")) return { ...g, score: "C" };
  return g;
}

const SYSTEM = `You are the Evaluator for Dilly, a commercial roofing sales platform. You grade one agent output before a human sees it.
Scale: A = ship as-is · B = minor edit · C = rework · D = block · F = block and escalate.
Flags (use these exact strings when they apply): hallucination_risk (any name, number, date or fact not present in CONTEXT), compliance_risk, format_violation, fluff, missing_required.
Grade only what is in OUTPUT against CONTEXT and the RUBRIC. Be strict and brief. The rationale must be something a sales manager can argue with.`;

export async function grade(
  llm: RunLlm,
  args: { output: unknown; rubric: Rubric; context?: unknown },
): Promise<Grade> {
  const { rubric } = args;
  const user = [
    `AGENT: ${rubric.agentKey}`,
    `MISSION: ${rubric.mission}`,
    `RUBRIC — must:\n${rubric.checks.map((c) => `- ${c}`).join("\n")}`,
    `RUBRIC — never (any violation is D or worse):\n${rubric.never.map((c) => `- ${c}`).join("\n")}`,
    `CONTEXT (the only facts the agent was given):\n${JSON.stringify(args.context ?? {}, null, 1)}`,
    `OUTPUT:\n${JSON.stringify(args.output, null, 1)}`,
  ].join("\n\n");
  const res = await llm.complete({
    tier: "sonnet",
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    maxTokens: 600,
    json: GradeSchema,
  });
  return applyGradeCaps(res.data);
}
