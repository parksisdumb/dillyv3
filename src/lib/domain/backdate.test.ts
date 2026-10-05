import { describe, expect, it } from "vitest";
import { backdateLimitDays, checkOccurredAt, defaultWhen, isLoggedLater, loggingForLabel, occurredAtFor, pickBounds } from "./backdate";

const TZ = "America/Chicago"; // CDT in October: UTC-5
// Tue Oct 6 2026, 3:20 PM in Chicago.
const NOW = new Date("2026-10-06T20:20:00Z");

describe("When chip → occurred_at (company zone)", () => {
  it("Now sends nothing (the server stamps it)", () => {
    expect(occurredAtFor(defaultWhen("now", NOW, TZ), NOW, TZ)).toBeNull();
  });

  it("Earlier today defaults to about an hour ago, on today's date", () => {
    const w = defaultWhen("earlier_today", NOW, TZ);
    expect(w.time).toBe("14:15");
    expect(occurredAtFor(w, NOW, TZ)).toBe("2026-10-06T19:15:00.000Z");
    expect(occurredAtFor({ ...w, time: "08:30" }, NOW, TZ)).toBe("2026-10-06T13:30:00.000Z");
  });

  it("Yesterday uses the company's yesterday, not UTC's", () => {
    // 11:30 PM Chicago on Oct 6 is already Oct 7 in UTC: yesterday is still Oct 5 locally.
    const late = new Date("2026-10-07T04:30:00Z");
    const w = { ...defaultWhen("yesterday", late, TZ), time: "14:30" };
    expect(occurredAtFor(w, late, TZ)).toBe("2026-10-05T19:30:00.000Z");
  });

  it("Pick reads the datetime-local value in the company's zone (DST-aware)", () => {
    const w = { ...defaultWhen("pick", NOW, TZ), at: "2026-10-01T14:30" };
    expect(occurredAtFor(w, NOW, TZ)).toBe("2026-10-01T19:30:00.000Z");
    // Before the November fall-back the offset is -5, after it -6.
    expect(occurredAtFor({ ...w, at: "2026-11-10T09:00" }, NOW, TZ)).toBe("2026-11-10T15:00:00.000Z");
    expect(occurredAtFor({ ...w, at: "" }, NOW, TZ)).toBeNull();
  });

  it("labels the line reps see before they log", () => {
    expect(loggingForLabel("2026-10-01T19:30:00.000Z", TZ)).toBe("Thu Oct 1, 2:30 PM");
  });

  it("bounds the picker to now and the rep's window", () => {
    expect(pickBounds(NOW, TZ, 30)).toEqual({ min: "2026-09-06T15:20", max: "2026-10-06T15:20" });
    expect(pickBounds(NOW, TZ, null).min).toBeUndefined();
  });
});

describe("occurred_at validation by role", () => {
  it("reps get tenant.settings.backdate_days (default 30); managers, admins and owners are unlimited", () => {
    expect(backdateLimitDays("rep", {})).toBe(30);
    expect(backdateLimitDays("rep", null)).toBe(30);
    expect(backdateLimitDays("rep", { backdate_days: 7 })).toBe(7);
    expect(backdateLimitDays("estimator", { backdate_days: "14" })).toBe(14);
    expect(backdateLimitDays("rep", { backdate_days: "nope" })).toBe(30);
    for (const r of ["manager", "admin", "owner"]) expect(backdateLimitDays(r, { backdate_days: 7 })).toBeNull();
  });

  it("rejects the future beyond 5 minutes of clock drift (which counts as now)", () => {
    expect(checkOccurredAt(new Date(NOW.getTime() + 3 * 60_000).toISOString(), NOW, 30)).toEqual({ ok: true, at: null });
    const r = checkOccurredAt(new Date(NOW.getTime() + 10 * 60_000).toISOString(), NOW, null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/future/);
  });

  it("lets a rep go back up to the limit, not past it; a manager anywhere back", () => {
    const d = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    expect(checkOccurredAt(d(29), NOW, 30)).toEqual({ ok: true, at: d(29) });
    expect(checkOccurredAt(d(30), NOW, 30).ok).toBe(true);
    const r = checkOccurredAt(d(45), NOW, 30);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Reps can log up to 30 days back. Ask your manager to log anything older.");
    expect(checkOccurredAt(d(45), NOW, null)).toEqual({ ok: true, at: d(45) });
    expect(checkOccurredAt(d(400), NOW, null).ok).toBe(true);
    expect(checkOccurredAt("garbage", NOW, null).ok).toBe(false);
  });
});

describe("Logged later", () => {
  it("is more than an hour between when it happened and when it was entered", () => {
    expect(isLoggedLater("2026-10-05T14:00:00Z", "2026-10-06T09:00:00Z")).toBe(true);
    expect(isLoggedLater("2026-10-06T08:30:00Z", "2026-10-06T09:00:00Z")).toBe(false);
    expect(isLoggedLater("2026-10-06T08:30:00Z", null)).toBe(false);
  });
});
