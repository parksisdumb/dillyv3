import { describe, expect, it } from "vitest";
import { dayStartISO, dueLabel, logToast, nextBusinessDay, weekStart, quietLabel } from "./format";

describe("format", () => {
  it("dueLabel speaks field language", () => {
    expect(dueLabel("2026-10-15", "2026-10-15")).toBe("Today");
    expect(dueLabel("2026-10-16", "2026-10-15")).toBe("Tomorrow");
    expect(dueLabel("2026-10-19", "2026-10-15")).toBe("Mon");
    expect(dueLabel("2026-11-02", "2026-10-15")).toBe("Nov 2");
  });
  it("nextBusinessDay skips weekends", () => {
    expect(nextBusinessDay("2026-10-16")).toBe("2026-10-19");
    expect(nextBusinessDay("2026-10-14")).toBe("2026-10-15");
  });
  it("weekStart is Monday", () => {
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
  it("dayStartISO honors the zone", () => {
    expect(dayStartISO("2026-10-15", "America/Chicago")).toBe("2026-10-15T05:00:00.000Z");
    expect(dayStartISO("2026-01-15", "America/Chicago")).toBe("2026-01-15T06:00:00.000Z");
  });
  it("logToast says exactly what happened", () => {
    expect(logToast({ points: 4, closed: 1, next: { title: "Call Dave back", due_on: "2026-10-15" }, today: "2026-10-12" })).toBe(
      "+4 · follow-up closed · next: Call Dave back Thu",
    );
    expect(logToast({ points: 0, closed: 0, next: null, today: "2026-10-12" })).toBe("Logged · no follow-up set");
  });
  it("quietLabel", () => {
    expect(quietLabel(22, "2026-09-01")).toBe("Quiet 22 days");
    expect(quietLabel(null, null)).toBe("Never touched");
  });
});
