import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isIdempotent, resilientFetch } from "@/lib/supabase/fetch";

const URL_GET = "https://x.supabase.co/rest/v1/account?select=id&tenant_id=eq.1";
const URL_RPC_READ = "https://x.supabase.co/rest/v1/rpc/rep_queue";
const URL_RPC_WRITE = "https://x.supabase.co/rest/v1/rpc/claim_invites";
const URL_INSERT = "https://x.supabase.co/rest/v1/touch";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("isIdempotent", () => {
  it("treats reads and read-only RPCs as retryable, writes as not", () => {
    expect(isIdempotent("GET", "/rest/v1/account")).toBe(true);
    expect(isIdempotent("POST", "/rest/v1/rpc/rep_queue")).toBe(true);
    expect(isIdempotent("POST", "/rest/v1/rpc/leaderboard")).toBe(true);
    expect(isIdempotent("POST", "/rest/v1/rpc/claim_invites")).toBe(false);
    expect(isIdempotent("POST", "/rest/v1/touch")).toBe(false);
    expect(isIdempotent("PATCH", "/rest/v1/task")).toBe(false);
    expect(isIdempotent("DELETE", "/rest/v1/task")).toBe(false);
  });
});

describe("resilientFetch", () => {
  it("retries an idempotent read once on a network error", async () => {
    const impl = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const f = resilientFetch({ fetchImpl: impl as unknown as typeof fetch, retryDelayMs: 1 });
    const res = await f(URL_GET);
    expect(res.status).toBe(200);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("retries a read-only RPC once on 503", async () => {
    const impl = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const f = resilientFetch({ fetchImpl: impl as unknown as typeof fetch, retryDelayMs: 1 });
    const res = await f(URL_RPC_READ, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("never retries writes", async () => {
    for (const [url, method] of [
      [URL_INSERT, "POST"],
      [URL_RPC_WRITE, "POST"],
      [URL_INSERT, "PATCH"],
    ] as const) {
      const impl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
      const f = resilientFetch({ fetchImpl: impl as unknown as typeof fetch, retryDelayMs: 1 });
      await expect(f(url, { method, body: "{}" })).rejects.toThrow("fetch failed");
      expect(impl).toHaveBeenCalledTimes(1);

      const impl503 = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
      const f503 = resilientFetch({ fetchImpl: impl503 as unknown as typeof fetch, retryDelayMs: 1 });
      expect((await f503(url, { method, body: "{}" })).status).toBe(503);
      expect(impl503).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after one retry", async () => {
    const impl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const f = resilientFetch({ fetchImpl: impl as unknown as typeof fetch, retryDelayMs: 1 });
    await expect(f(URL_GET)).rejects.toThrow("fetch failed");
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("times out a hung request with an AbortError (postgrest-js turns it into { error })", async () => {
    const impl = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
    );
    const f = resilientFetch({ fetchImpl: impl as unknown as typeof fetch, timeoutMs: 20, retries: 0 });
    const err = await f(URL_GET).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AbortError");
    expect((err as Error).message).toMatch(/timed out after 20ms/);
  });

  it("does not retry or relabel when the caller aborts", async () => {
    const ctrl = new AbortController();
    const impl = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new DOMException("caller", "AbortError")));
        }),
    );
    const f = resilientFetch({ fetchImpl: impl as unknown as typeof fetch, timeoutMs: 5_000, retryDelayMs: 1 });
    const p = f(URL_GET, { signal: ctrl.signal });
    ctrl.abort();
    const err = (await p.catch((e: Error) => e)) as Error;
    expect(err.message).toBe("caller");
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
