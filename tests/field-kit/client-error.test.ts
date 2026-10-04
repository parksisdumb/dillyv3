import { describe, expect, it } from "vitest";
import { clientIp, MAX_BODY_BYTES, parseClientErrors, scrubUrl, tokenBuckets } from "@/lib/observability/client-error";

const U = "11111111-1111-4111-8111-111111111111";

describe("client error payload", () => {
  it("accepts a batch and a single object; truncates long fields; scrubs query strings", () => {
    const one = parseClientErrors(JSON.stringify({ message: "x".repeat(900), stack: "s", url: "https://app/login?token=SECRET#a", user: U }));
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.errors[0].message).toHaveLength(500);
    expect(one.errors[0].url).toBe("https://app/login");
    expect(one.errors[0].kind).toBe("error");
    const batch = parseClientErrors(JSON.stringify({ errors: [{ message: "a" }, { message: "b", kind: "boundary", where: "Go" }] }));
    expect(batch.ok && batch.errors.map((e) => e.kind)).toEqual(["error", "boundary"]);
  });
  it("rejects bad JSON, empty/oversized batches, bad ids and oversized bodies", () => {
    expect(parseClientErrors("{nope")).toEqual({ ok: false, status: 400, error: "bad_json" });
    expect(parseClientErrors(JSON.stringify({ errors: [] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseClientErrors(JSON.stringify({ errors: Array.from({ length: 11 }, () => ({ message: "a" })) }))).toMatchObject({ ok: false, status: 400 });
    expect(parseClientErrors(JSON.stringify({ message: "a", user: "dave@example.com" }))).toMatchObject({ ok: false, status: 400 }); // ids only, no PII
    expect(parseClientErrors(JSON.stringify({ message: "" }))).toMatchObject({ ok: false });
    expect(parseClientErrors("x".repeat(MAX_BODY_BYTES + 1))).toEqual({ ok: false, status: 413, error: "too_large" });
  });
  it("scrubUrl keeps origin + path", () => {
    expect(scrubUrl("https://dilly.app/auth/callback?code=abc")).toBe("https://dilly.app/auth/callback");
    expect(scrubUrl("not a url?x=1")).toBe("not a url");
    expect(scrubUrl(null)).toBeNull();
  });
});

describe("per-IP token bucket", () => {
  it("allows a burst, then refills over time, per key", () => {
    let t = 0;
    const b = tokenBuckets({ capacity: 3, refillPerSec: 1, now: () => t });
    expect([b.take("a"), b.take("a"), b.take("a"), b.take("a")]).toEqual([true, true, true, false]);
    expect(b.take("b")).toBe(true); // separate IP
    t = 1000;
    expect(b.take("a")).toBe(true);
    expect(b.take("a")).toBe(false);
    t = 10_000;
    expect(b.take("a", 3)).toBe(true); // capped at capacity
    expect(b.take("a")).toBe(false);
  });
  it("bounds memory by evicting the oldest keys", () => {
    const b = tokenBuckets({ capacity: 1, refillPerSec: 1, maxKeys: 2, now: () => 0 });
    b.take("1");
    b.take("2");
    b.take("3");
    expect(b.size()).toBe(2);
  });
  it("client IP from x-forwarded-for (first hop)", () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
