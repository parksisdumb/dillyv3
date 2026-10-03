import { describe, expect, it } from "vitest";
import { computeBadges, longestClearedRun, type BadgePointEvent } from "./badges";

const TZ = "America/Chicago";
const today = "2026-10-15"; // Thursday

function ev(event: string, occurred_at: string, voided = false): BadgePointEvent {
  return { event, occurred_at, voided };
}
const byKey = (badges: ReturnType<typeof computeBadges>) => Object.fromEntries(badges.map((b) => [b.key, b]));

describe("longestClearedRun", () => {
  it("counts consecutive weekdays across a weekend", () => {
    // Thu Oct 1, Fri Oct 2, (weekend), Mon Oct 5, Tue Oct 6, Wed Oct 7
    const days = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"].map((day) => ({ day, cleared: true }));
    expect(longestClearedRun(days)).toBe(5);
  });

  it("breaks the run on a missing or uncleared weekday", () => {
    const days = [
      { day: "2026-10-05", cleared: true },
      { day: "2026-10-06", cleared: true },
      { day: "2026-10-07", cleared: false },
      { day: "2026-10-08", cleared: true },
      { day: "2026-10-09", cleared: true },
      { day: "2026-10-12", cleared: true },
    ];
    expect(longestClearedRun(days)).toBe(3);
  });

  it("ignores weekend rows", () => {
    expect(longestClearedRun([{ day: "2026-10-03", cleared: true }])).toBe(0);
  });
});

describe("computeBadges", () => {
  it("returns all six badges unearned with no activity", () => {
    const b = computeBadges({ pointEvents: [], repDays: [], today, timeZone: TZ });
    expect(b).toHaveLength(6);
    expect(b.every((x) => !x.earned && x.progress === 0)).toBe(true);
  });

  it("Clean Sheet at 5 cleared weekdays in a row", () => {
    const repDays = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((day) => ({ day, cleared: true }));
    expect(byKey(computeBadges({ pointEvents: [], repDays, today, timeZone: TZ })).clean_sheet.earned).toBe(true);
  });

  it("Door Opener counts only this month's decision-maker conversations", () => {
    const thisMonth = Array.from({ length: 9 }, (_, i) => ev("decision_maker_conversation", `2026-10-0${i + 1}T15:00:00Z`));
    const lastMonth = ev("decision_maker_conversation", "2026-09-20T15:00:00Z");
    let b = byKey(computeBadges({ pointEvents: [...thisMonth, lastMonth], repDays: [], today, timeZone: TZ }));
    expect(b.door_opener.earned).toBe(false);
    expect(b.door_opener.progress).toBe(9);
    b = byKey(computeBadges({ pointEvents: [...thisMonth, ev("decision_maker_conversation", "2026-10-14T15:00:00Z")], repDays: [], today, timeZone: TZ }));
    expect(b.door_opener.earned).toBe(true);
  });

  it("uses the tenant time zone for month boundaries", () => {
    // 2026-10-01T03:00Z is still Sep 30 in Chicago.
    const b = byKey(computeBadges({ pointEvents: [ev("decision_maker_conversation", "2026-10-01T03:00:00Z")], repDays: [], today, timeZone: TZ }));
    expect(b.door_opener.progress).toBe(0);
  });

  it("Card Collector at 25 field contacts this month", () => {
    const evs = Array.from({ length: 25 }, () => ev("field_contact_created", "2026-10-10T15:00:00Z"));
    expect(byKey(computeBadges({ pointEvents: evs, repDays: [], today, timeZone: TZ })).card_collector.earned).toBe(true);
  });

  it("Host, Closer on any single event; voided events don't count", () => {
    const b = byKey(
      computeBadges({
        pointEvents: [ev("lunch_and_learn", "2026-03-01T15:00:00Z"), ev("won", "2026-10-01T15:00:00Z", true)],
        repDays: [],
        today,
        timeZone: TZ,
      }),
    );
    expect(b.host.earned).toBe(true);
    expect(b.closer.earned).toBe(false);
  });

  it("Rescue at 5 cold rescues all-time, progress capped at target", () => {
    const evs = Array.from({ length: 7 }, (_, i) => ev("cold_rescued", `2026-0${(i % 9) + 1}-10T15:00:00Z`));
    const b = byKey(computeBadges({ pointEvents: evs, repDays: [], today, timeZone: TZ }));
    expect(b.rescue.earned).toBe(true);
    expect(b.rescue.progress).toBe(5);
  });
});
