import { describe, expect, it } from "vitest";
import { buildScorecard, monthStarts, monthlyGoal, parseTargets, sparkGeometry, weekStarts, weeklyGoal } from "./scorecard";

describe("scorecard", () => {
  it("weeks start Monday and end with this week; months roll over the year", () => {
    const w = weekStarts("2026-10-04"); // a Sunday
    expect(w).toHaveLength(13);
    expect(w[12]).toBe("2026-09-28");
    expect(w[0]).toBe("2026-07-06");
    expect(monthStarts("2026-01-15")).toEqual({ thisMonth: "2026-01-01", lastMonth: "2025-12-01" });
  });

  it("aggregates per rep and company; follow-up is a rate, null when nothing was due", () => {
    const rows = [
      { user_id: "a", bucket: "month", period_start: "2026-10-01", meetings: 3, in_person: 5, first_touches: 1, fu_due: 4, fu_done: 3, paperwork: 0 },
      { user_id: "b", bucket: "month", period_start: "2026-10-01", meetings: 2, in_person: 1, first_touches: 0, fu_due: 0, fu_done: 0, paperwork: 1 },
      { user_id: null, bucket: "month", period_start: "2026-09-01", meetings: 0, in_person: 0, first_touches: 0, fu_due: 0, fu_done: 0, paperwork: 2 },
      { user_id: "a", bucket: "week", period_start: "2026-09-28", meetings: 1, in_person: 2, first_touches: 0, fu_due: 2, fu_done: 1, paperwork: 0 },
    ];
    const sc = buildScorecard(rows, [{ user_id: "a", name: "Ann" }, { user_id: "b", name: "Bo" }], "2026-10-04", {});
    expect(sc.company.meetings).toMatchObject({ thisMonth: 5, lastMonth: 0 });
    expect(sc.company.paperwork).toMatchObject({ thisMonth: 1, lastMonth: 2 });
    expect(sc.company.follow_up.thisMonth).toBe(75);
    expect(sc.reps.find((r) => r.user_id === "b")!.metrics.follow_up.thisMonth).toBeNull();
    expect(sc.company.in_person.weeks.at(-1)).toBe(2);
    expect(sc.company.in_person.weeks[0]).toBe(0);
  });

  it("goals: monthly → weekly equivalent; in-person per rep scales with the team", () => {
    const t = parseTargets({ scorecard_targets: { meetings_month: 26, in_person_rep_week: 10, follow_up_pct: 90 } });
    expect(weeklyGoal("meetings", t, 3)).toBe(6);
    expect(weeklyGoal("in_person", t, 3)).toBe(30);
    expect(monthlyGoal("in_person", t, 3)).toBe(130);
    expect(weeklyGoal("follow_up", t, 3)).toBe(90);
    expect(weeklyGoal("paperwork", t, 3)).toBeNull();
    expect(parseTargets({ scorecard_targets: { meetings_month: -1 } })).toEqual({});
  });

  it("sparkline uses one scale from zero that includes the goal, and breaks on gaps", () => {
    const g = sparkGeometry([0, 5, null, 10], 20, 100, 50, { t: 0, r: 0, b: 0, l: 0 });
    expect(g.max).toBe(20);
    expect(g.y(0)).toBe(50);
    expect(g.goalY).toBe(0);
    expect(g.line.match(/M/g)).toHaveLength(2);
    expect(g.last).toEqual([100, 25]);
  });
});
