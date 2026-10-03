/**
 * Thin wrapper over the Anthropic Messages API.
 *
 * - The network call is behind `LlmTransport` so tests inject a fake (dependency injection, no module mocks).
 * - `complete({ json: schema })` instructs JSON-only output, extracts the object robustly, validates with zod,
 *   and retries ONCE with the parse/validation error fed back. A second failure throws `LlmJsonError`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { costUsd, modelFor, type EnvSource, type Tier } from "./models";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TransportRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
}

export interface TransportResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** The only thing that talks to the network. */
export type LlmTransport = (req: TransportRequest) => Promise<TransportResponse>;

export interface LlmUsage {
  tier: Tier;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
}

export interface CompleteOptions {
  tier: Tier;
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

export interface TextResult {
  text: string;
  usage: LlmUsage;
}

export interface JsonResult<T> extends TextResult {
  data: T;
  attempts: number;
}

export class LlmJsonError extends Error {
  constructor(
    message: string,
    readonly lastText: string,
    readonly usage: LlmUsage,
  ) {
    super(message);
    this.name = "LlmJsonError";
  }
}

export class LlmUnavailableError extends Error {
  constructor() {
    super("LLM unavailable: ANTHROPIC_API_KEY is not set. Callers must use their deterministic fallback.");
    this.name = "LlmUnavailableError";
  }
}

export function anthropicTransport(apiKey: string): LlmTransport {
  const client = new Anthropic({ apiKey });
  return async ({ model, system, messages, maxTokens }) => {
    const res = await client.messages.create({ model, system, messages, max_tokens: maxTokens });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  };
}

/** Default transport from env, or null when no API key is configured (the app must work without the LLM). */
export function defaultTransport(source: EnvSource = process.env): LlmTransport | null {
  const key = source.ANTHROPIC_API_KEY?.trim();
  return key ? anthropicTransport(key) : null;
}

/**
 * Pull the first complete top-level JSON object out of a model reply.
 * Handles ```json fences, prose before/after, and braces inside strings.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], text] : [text];
  let lastErr: unknown = new Error("No JSON object found in reply");
  for (const src of candidates) {
    let start = src.indexOf("{");
    while (start !== -1) {
      const end = matchBrace(src, start);
      if (end === -1) break;
      try {
        return JSON.parse(src.slice(start, end + 1));
      } catch (e) {
        lastErr = e;
      }
      start = src.indexOf("{", start + 1);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function matchBrace(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function jsonInstruction(schema: z.ZodType): string {
  let shape = "";
  try {
    shape = JSON.stringify(z.toJSONSchema(schema));
  } catch {
    shape = "(see instructions above)";
  }
  return (
    "\n\nOUTPUT FORMAT: Reply with ONE JSON object and nothing else — no prose, no markdown fences. " +
    `It must validate against this JSON Schema: ${shape}`
  );
}

function describeError(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * LLM client. `onUsage` is called after every transport call so a run can accumulate tokens/cost.
 */
export class Llm {
  constructor(
    private readonly transport: LlmTransport,
    private readonly env: EnvSource = process.env,
    private readonly onUsage?: (u: LlmUsage) => void,
  ) {}

  private async call(opts: CompleteOptions, system: string, messages: LlmMessage[]) {
    const model = modelFor(opts.tier, this.env);
    const res = await this.transport({ model, system, messages, maxTokens: opts.maxTokens ?? 1024 });
    const usage: LlmUsage = {
      tier: opts.tier,
      model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: costUsd(opts.tier, res.inputTokens, res.outputTokens),
      calls: 1,
    };
    this.onUsage?.(usage);
    return { text: res.text, usage };
  }

  complete(opts: CompleteOptions): Promise<TextResult>;
  complete<T>(opts: CompleteOptions & { json: z.ZodType<T> }): Promise<JsonResult<T>>;
  async complete<T>(opts: CompleteOptions & { json?: z.ZodType<T> }): Promise<TextResult | JsonResult<T>> {
    if (!opts.json) return this.call(opts, opts.system, opts.messages);

    const schema = opts.json;
    const system = opts.system + jsonInstruction(schema);
    const messages = [...opts.messages];
    let total: LlmUsage | null = null;
    let lastText = "";
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { text, usage } = await this.call(opts, system, messages);
      total = total ? addUsage(total, usage) : usage;
      lastText = text;
      try {
        const data = schema.parse(extractJsonObject(text));
        return { text, data, usage: total, attempts: attempt };
      } catch (e) {
        lastError = describeError(e);
        messages.push(
          { role: "assistant", content: text || "(empty)" },
          {
            role: "user",
            content: `That reply was not valid: ${lastError}. Reply again with only the corrected JSON object.`,
          },
        );
      }
    }
    throw new LlmJsonError(`Model output failed JSON validation twice: ${lastError}`, lastText, total!);
  }
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    tier: b.tier,
    model: b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    calls: a.calls + b.calls,
  };
}
