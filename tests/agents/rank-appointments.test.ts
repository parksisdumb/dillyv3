// Today's appointments in the brief: top of the queue in time order, "first … at" in the Due line, and the
// reminder push `reminder_minutes` before each one (bypasses the 3-a-day cap, never quiet hours).
import { describe, expect, it } from "vitest";
import { rank, type RankInput, type TodayAppointment } from "@/agents/rep-daily-brief/rank";
import { dueLine, templateBrief } from "@/agents/rep-daily-brief/template";
import { notificationFor } from "@/lib/push/copy";
import type { LocalClock } from "@/agents/runtime/clock";
import { MON, opp, settings, signal, task } from "./fixtures";

// MON = 2026-10-05 (CDT, UTC-5): 09:00 local = 14:00Z.
const appt = (over: Partial<TodayAppointment> = {}): TodayAppointment => ({
  id: "a1",
  title: "Inspection · Greystar Riverside",
  kind: "inspection",
  startsAt: "2026-10-05T14:00:00.000Z",
  allDay: false,
  place: "1801 S Pleasant Valley Rd, Austin, TX",
  buildings: 3,
  accountId: "acct-g",
  accountName: "Greystar Riverside",
  reminderMinutes: 60,
  ...over,
});
const input = (over: Partial<RankInput> = {}): RankInput => ({ today: MON, queue: [], opportunities: [], signals: [], settings: settings(), ...over });
const clock = (hhmm: string): LocalClock => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return { date: MON, hour, minute, isoDow: 1 };
};

describe("rank — appointments lead the day", () => {
  it("today's appointments go first, in time order, ahead of the one thing", () => {
    const stalled = opp({ stage: "proposal_sent", value: 160_000, daysInStage: 18, accountName: "Lincoln" });
    const r = rank(
      input({
        queue: [task({ overdue_days: 2, due_on: "2026-10-01" })],
        opportunities: [stalled],
        appointments: [appt({ id: "late", title: "Lunch & learn · CBRE", startsAt: "2026-10-05T17:30:00.000Z", buildings: 0 }), appt()],
      }),
    );
    expect(r.items.slice(0, 2).map((i) => i.key)).toEqual(["appt:a1", "appt:late"]);
    expect(r.items[0]).toMatchObject({ type: "appointment", appointmentId: "a1", why: "9:00 · 1801 S Pleasant Valley Rd, Austin, TX · 3 buildings" });
    expect(r.items[1].why).toBe("12:30 PM · 1801 S Pleasant Valley Rd, Austin, TX");
    expect(r.items[2].opportunityId).toBe(stalled.id); // the one thing leads the work after appointments
    expect(r.oneThing?.kind).toBe("stalled_proposal");
    expect(r.isEmpty).toBe(false);
  });

  it("Due line: '2 appointments (first 9:00 at Greystar Riverside)' before follow-ups", () => {
    const r = rank(input({ queue: [task()], appointments: [appt({ id: "b", startsAt: "2026-10-05T19:00:00.000Z" }), appt()] }));
    expect(r.due.firstMeetingAt).toBe("9:00 at Greystar Riverside");
    expect(r.due.appointments).toBe(2);
    expect(dueLine(r)).toBe("Due: 2 appointments (first 9:00 at Greystar Riverside), 1 follow-up.");
    // Only appointments → still a real brief, not "clear day".
    const only = rank(input({ appointments: [appt()] }));
    expect(templateBrief(only).lines[1].text).toBe("Due: 1 appointment (first 9:00 at Greystar Riverside).");
  });

  it("without appointments nothing changes", () => {
    const r = rank(input({ queue: [task()] }));
    expect(r.due.appointments).toBe(0);
    expect(r.due.firstMeetingAt).toBeNull();
    expect(r.items.every((i) => i.type !== "appointment")).toBe(true);
  });
});

describe("rank — appointment reminders", () => {
  it("fires reminder_minutes before the start, opens the appointment", () => {
    const at = (hhmm: string) => rank(input({ appointments: [appt()], clock: clock(hhmm) })).pushes.find((p) => p.key === "appt:a1")!;
    expect(at("07:59")).toMatchObject({ kind: "appointment", at: "08:00", dueNow: false });
    expect(at("08:00").dueNow).toBe(true);
    expect(at("08:45").dueNow).toBe(true);
    expect(at("09:00").dueNow).toBe(false); // started: too late to remind
    const p = at("08:15");
    expect(p.title).toBe("9:00 · Inspection · Greystar Riverside");
    expect(notificationFor(p, []).url).toBe("/app/appointments/a1");
  });

  it("bypasses the daily cap (and doesn't use it up)", () => {
    const big = [1, 2, 3, 4].map((n) => task({ task_id: `t${n}`, icp_tier: 1, account_id: `x${n}` }));
    const r = rank(input({ queue: big, appointments: [appt()], clock: clock("08:30"), pushesSentToday: ["due:t1", "due:t2", "due:t3"] }));
    expect(r.pushes.map((p) => p.key)).toEqual(["appt:a1"]);
    const r2 = rank(input({ queue: big, appointments: [appt()], clock: clock("08:30"), pushesSentToday: ["appt:a1"] }));
    expect(r2.pushes.filter((p) => p.kind === "due_today_big")).toHaveLength(3);
    expect(r2.suppressedPushes).toContainEqual({ key: "appt:a1", reason: "already_sent" });
  });

  it("respects quiet hours: before the window → window start if still before the appointment, else suppressed", () => {
    // Window 07:00–19:00. 7:30 appointment, 60 min reminder → 06:30 → moved to 07:00.
    const early = rank(input({ appointments: [appt({ startsAt: "2026-10-05T12:30:00.000Z" })], clock: clock("07:00") }));
    expect(early.pushes[0]).toMatchObject({ key: "appt:a1", at: "07:00", dueNow: true });
    // 6:45 appointment: nothing fits inside the window before it.
    const tooEarly = rank(input({ appointments: [appt({ startsAt: "2026-10-05T11:45:00.000Z" })] }));
    expect(tooEarly.pushes).toEqual([]);
    expect(tooEarly.suppressedPushes).toContainEqual({ key: "appt:a1", reason: "quiet_hours" });
    // 19:30 with a 15-min reminder → 19:15 is after the window closes.
    const late = rank(input({ appointments: [appt({ startsAt: "2026-10-06T00:30:00.000Z", reminderMinutes: 15 })] }));
    expect(late.suppressedPushes).toContainEqual({ key: "appt:a1", reason: "quiet_hours" });
    // No reminder / all-day: no push.
    expect(rank(input({ appointments: [appt({ reminderMinutes: 0 }), appt({ id: "d", allDay: true })] })).pushes).toEqual([]);
  });

  it("signals still push alongside", () => {
    const r = rank(input({ signals: [signal({ kind: "inbound_reply" })], appointments: [appt()], clock: clock("08:30") }));
    expect(r.pushes.map((p) => p.kind).sort()).toEqual(["appointment", "signal"]);
  });
});
