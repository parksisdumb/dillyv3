import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/server/safe-next";

describe("safeNext", () => {
  it("keeps same-origin relative paths with query and hash", () => {
    expect(safeNext("/app/accounts/123?tab=people#x")).toBe("/app/accounts/123?tab=people#x");
    expect(safeNext("/app/today")).toBe("/app/today");
  });
  it("rejects anything that can leave the origin", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "/\t/evil.com",
      " //evil.com",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad as string | null | undefined)).toBe("/app/today");
    }
  });
  it("does not loop back into login or the auth callback", () => {
    expect(safeNext("/login?next=/app")).toBe("/app/today");
    expect(safeNext("/auth/callback?code=x")).toBe("/app/today");
  });
  it("normalizes dot segments without escaping the origin", () => {
    expect(safeNext("/app/../app/today")).toBe("/app/today");
    expect(safeNext("/..//evil.com")).toBe("/app/today");
    expect(safeNext("/./%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});
