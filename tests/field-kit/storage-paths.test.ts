import { describe, expect, it } from "vitest";
import { mediaPath, parseMediaPath, pathInTenants } from "@/lib/storage/paths";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("media paths", () => {
  it("tenant_id/yyyy/mm/uuid.jpg, month from the capture time (UTC)", () => {
    expect(mediaPath(T, ID, new Date("2026-10-04T23:30:00Z"))).toBe(`${T}/2026/10/${ID}.jpg`);
    expect(mediaPath(T.toUpperCase(), ID, new Date("2027-01-01T00:00:00Z"))).toBe(`${T}/2027/01/${ID}.jpg`);
    expect(() => mediaPath("../etc", ID)).toThrow();
  });
  it("parses only our exact shape", () => {
    expect(parseMediaPath(`${T}/2026/10/${ID}.jpg`)).toEqual({ tenantId: T, year: "2026", month: "10", id: ID });
    for (const bad of [`${T}/2026/13/${ID}.jpg`, `${T}/2026/10/${ID}.png`, `../${T}/2026/10/${ID}.jpg`, `${T}/2026/10/x/${ID}.jpg`, "", null]) {
      expect(parseMediaPath(bad as string)).toBeNull();
    }
  });
  it("authorizes on the first segment", () => {
    expect(pathInTenants(`${T}/2026/10/${ID}.jpg`, [T])).toBe(true);
    expect(pathInTenants(`${T}/2026/10/${ID}.jpg`, ["33333333-3333-4333-8333-333333333333"])).toBe(false);
  });
});
