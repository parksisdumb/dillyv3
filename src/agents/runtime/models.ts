/**
 * Model tiering (§1 principle 8). Agents ask for a tier; the deployment decides the model id.
 * Model ids come ONLY from env (DILLY_MODEL_OPUS / _SONNET / _HAIKU) — never hardcode them here.
 */

export type Tier = "opus" | "sonnet" | "haiku";
export type StepTier = Tier | "none";

export const TIERS: readonly Tier[] = ["opus", "sonnet", "haiku"] as const;

const ENV_VAR: Record<Tier, string> = {
  opus: "DILLY_MODEL_OPUS",
  sonnet: "DILLY_MODEL_SONNET",
  haiku: "DILLY_MODEL_HAIKU",
};

export type EnvSource = Record<string, string | undefined>;

export class ModelNotConfiguredError extends Error {
  constructor(tier: Tier) {
    super(
      `No model configured for tier "${tier}". Set ${ENV_VAR[tier]} to the current Claude model id ` +
        `(Vercel env / .env.local). The runtime never hardcodes model ids.`,
    );
    this.name = "ModelNotConfiguredError";
  }
}

export function modelFor(tier: Tier, source: EnvSource = process.env): string {
  const id = source[ENV_VAR[tier]]?.trim();
  if (!id) throw new ModelNotConfiguredError(tier);
  return id;
}

/**
 * USD per million tokens, per tier. These are CONFIG, not truth:
 * UPDATE WHEN PRICING CHANGES or when a tier's env var is pointed at a different model generation.
 * Used only to compute agent_run.cost_usd for the Observability budget view.
 */
export const PRICING_USD_PER_MTOK: Record<Tier, { input: number; output: number }> = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};

export function costUsd(tier: Tier, inputTokens: number, outputTokens: number): number {
  const p = PRICING_USD_PER_MTOK[tier];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
