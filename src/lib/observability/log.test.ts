import { afterEach, describe, expect, it, vi } from "vitest";
import { log, serializeError, setErrorReporter, shortRef } from "@/lib/observability/log";

afterEach(() => {
  vi.restoreAllMocks();
  setErrorReporter(null);
});

describe("log", () => {
  it("writes one JSON line with level, msg, fields and a serialized error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("safe:leaderboard", { requestId: "r1", tenant: "t1", route: "/app/today", durationMs: 12, err: new Error("boom") });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", msg: "safe:leaderboard", requestId: "r1", tenant: "t1", route: "/app/today", durationMs: 12 });
    expect(line.err).toMatchObject({ name: "Error", message: "boom" });
    expect(typeof line.ts).toBe("string");
  });

  it("serializes PostgREST error objects", () => {
    expect(serializeError({ message: "permission denied", code: "42501" })).toEqual({ name: "Error", message: "permission denied", code: "42501" });
  });

  it("forwards errors to the reporter hook and survives a broken reporter", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    setErrorReporter((e) => seen.push(e.msg));
    log.error("a");
    setErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => log.error("b")).not.toThrow();
    expect(seen).toEqual(["a"]);
  });

  it("makes 8-char refs", () => {
    expect(shortRef("3F9A12BC-aaaa-bbbb")).toBe("3f9a12bc");
    expect(shortRef(null)).toHaveLength(8);
  });
});
