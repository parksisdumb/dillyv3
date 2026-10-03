import { describe, expect, it } from "vitest";
import { addDays, businessDaysBetween, isoDow, localClock, weekStart } from "@/agents/runtime/clock";
import { isCleanWeek } from "@/agents/rep-daily-brief/close-day";
import { isBriefWindow } from "@/inngest/tenants";
import { repContext, settings } from "./fixtures";

describe("clock", () => {
  it("converts to tenant-local time", () => {
    expect(localClock("America/Chicago", new Date("2026-10-05T11:05:00Z"))).toEqual({ date: "2026-10-05", hour: 6, minute: 5, isoDow: 1 });
    expect(localClock("America/Chicago", new Date("2026-10-05T04:30:00Z")).date).toBe("2026-10-04");
    expect(localClock("America/New_York", new Date("2026-10-05T04:30:00Z")).hour).toBe(0);
  });
  it("date math", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(isoDow("2026-10-11")).toBe(7);
    expect(weekStart("2026-10-09")).toBe("2026-10-05");
    expect(businessDaysBetween("2026-10-02", "2026-10-05")).toBe(1);
    expect(businessDaysBetween("2026-10-05", "2026-10-09")).toBe(4);
    expect(businessDaysBetween("2026-10-05", "2026-10-05")).toBe(0);
  });
});

describe("brief fan-out window", () => {
  const t = repContext().tenant;
  it("06:00–06:14 local on weekdays only, weekends when enabled", () => {
    const at = (iso: string) => localClock(t.timezone, new Date(iso));
    expect(isBriefWindow(at("2026-10-05T11:00:00Z"), t)).toBe(true); // Mon 06:00
    expect(isBriefWindow(at("2026-10-05T11:14:00Z"), t)).toBe(true);
    expect(isBriefWindow(at("2026-10-05T11:15:00Z"), t)).toBe(false);
    expect(isBriefWindow(at("2026-10-10T11:00:00Z"), t)).toBe(false); // Sat
    expect(isBriefWindow(at("2026-10-10T11:00:00Z"), { ...t, settings: settings({ weekendReminders: true }) })).toBe(true);
  });
});

describe("clean week", () => {
  const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  it("requires all five weekdays cleared", () => {
    expect(isCleanWeek(week.map((day) => ({ day, cleared: true })), "2026-10-09")).toBe(true);
    expect(isCleanWeek(week.map((day, i) => ({ day, cleared: i !== 2 })), "2026-10-09")).toBe(false);
    expect(isCleanWeek(week.slice(1).map((day) => ({ day, cleared: true })), "2026-10-09")).toBe(false);
  });
});
