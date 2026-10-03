import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonObject, Llm, LlmJsonError } from "@/agents/runtime/llm";
import { costUsd, modelFor, ModelNotConfiguredError, PRICING_USD_PER_MTOK } from "@/agents/runtime/models";
import { fakeTransport, MODEL_ENV } from "./fixtures";

const Schema = z.object({ a: z.number(), b: z.string() });

describe("extractJsonObject", () => {
  it("handles fences, surrounding prose and braces inside strings", () => {
    expect(extractJsonObject('```json\n{"a":1,"b":"x"}\n```')).toEqual({ a: 1, b: "x" });
    expect(extractJsonObject('Sure! Here it is: {"a":2,"b":"{not a brace}"} hope that helps')).toEqual({ a: 2, b: "{not a brace}" });
    expect(extractJsonObject('{"a":3,"b":"say \\"hi\\" }"}')).toEqual({ a: 3, b: 'say "hi" }' });
    expect(extractJsonObject('{broken} then {"a":4,"b":"ok"}')).toEqual({ a: 4, b: "ok" });
  });
  it("throws when there is no object", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("Llm.complete", () => {
  it("returns plain text with usage and cost from the tier's pricing", async () => {
    const { transport, requests } = fakeTransport(["hello"], { input: 1_000_000, output: 1_000_000 });
    const res = await new Llm(transport, MODEL_ENV).complete({ tier: "haiku", system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(res.text).toBe("hello");
    expect(requests[0].model).toBe("test-haiku");
    expect(res.usage.costUsd).toBe(PRICING_USD_PER_MTOK.haiku.input + PRICING_USD_PER_MTOK.haiku.output);
  });

  it("validates JSON with zod and instructs JSON output", async () => {
    const { transport, requests } = fakeTransport(['{"a":1,"b":"x"}']);
    const res = await new Llm(transport, MODEL_ENV).complete({ tier: "sonnet", system: "base", messages: [{ role: "user", content: "go" }], json: Schema });
    expect(res.data).toEqual({ a: 1, b: "x" });
    expect(res.attempts).toBe(1);
    expect(requests[0].system).toContain("base");
    expect(requests[0].system).toContain("JSON Schema");
  });

  it("retries once with the validation error fed back, accumulating usage", async () => {
    const { transport, requests } = fakeTransport(['{"a":"one","b":"x"}', '```json\n{"a":1,"b":"x"}\n```']);
    const seen: number[] = [];
    const llm = new Llm(transport, MODEL_ENV, (u) => seen.push(u.inputTokens));
    const res = await llm.complete({ tier: "opus", system: "s", messages: [{ role: "user", content: "go" }], json: Schema });
    expect(res.data.a).toBe(1);
    expect(res.attempts).toBe(2);
    expect(res.usage.calls).toBe(2);
    expect(res.usage.inputTokens).toBe(200);
    expect(seen).toEqual([100, 100]);
    const retry = requests[1].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: "assistant", content: '{"a":"one","b":"x"}' });
    expect(retry[2].content).toMatch(/^That reply was not valid: a: /);
  });

  it("throws LlmJsonError after the second failure", async () => {
    const { transport, requests } = fakeTransport(["nope", "still nope"]);
    await expect(
      new Llm(transport, MODEL_ENV).complete({ tier: "opus", system: "s", messages: [{ role: "user", content: "go" }], json: Schema }),
    ).rejects.toBeInstanceOf(LlmJsonError);
    expect(requests).toHaveLength(2);
  });
});

describe("models", () => {
  it("reads model ids from env and fails clearly when unset", () => {
    expect(modelFor("opus", MODEL_ENV)).toBe("test-opus");
    expect(() => modelFor("opus", {})).toThrow(ModelNotConfiguredError);
    expect(() => modelFor("sonnet", {})).toThrow(/DILLY_MODEL_SONNET/);
  });
  it("computes cost per tier", () => {
    expect(costUsd("sonnet", 2_000_000, 0)).toBe(2 * PRICING_USD_PER_MTOK.sonnet.input);
  });
});
