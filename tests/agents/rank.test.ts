import { describe, expect, it } from "vitest";
import { clip, fmtUsd, rank, settingsFromTenant, type RankInput } from "@/agents/rep-daily-brief/rank";
import type { LocalClock } from "@/agents/runtime/clock";
import { MON, TZ, opp, reengage, settings, signal, task } from "./fixtures";

function input(over: Partial<RankInput> = {}): RankInput {
  return { today: MON, queue: [], opportunities: [], signals: [], settings: settings(), ...over };
}
const clock = (date: string, hhmm: string, isoDow = 1): LocalClock => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return { date, hour, minute, isoDow };
};

describe("rank — the one thing", () => {
  const stalled = opp({ stage: "proposal_sent", value: 160_000, daysInStage: 18, nextStep: "call Dave on pricing", accountName: "Greystar" });
  const reply = signal({ kind: "inbound_reply", headline: "Dave replied: send the proposal again", accountName: "Lincoln" });
  const coldP1 = reengage();
  const overdue = task({ overdue_days: 2, due_on: "2026-10-01" });

  it("stalled big proposal beats hot reply, P1 going cold and overdue follow-ups", () => {
    const r = rank(input({ queue: [coldP1, overdue], opportunities: [stalled], signals: [reply] }));
    expect(r.oneThing?.kind).toBe("stalled_proposal");
    expect(r.oneThing?.text).toContain("$160K");
    expect(r.oneThing?.text).toContain("Greystar");
    expect(r.oneThing?.text).toContain("18 days");
    expect(r.items[0].opportunityId).toBe(stalled.id); // pinned to the top of the queue
  });

  it("hot reply beats P1 going cold and overdue", () => {
    const r = rank(input({ queue: [coldP1, overdue], signals: [reply] }));
    expect(r.oneThing?.kind).toBe("hot_reply");
    expect(r.oneThing?.text).toContain("Lincoln");
    expect(r.items[0].signalId).toBe(reply.id);
  });

  it("P1 going cold beats overdue follow-ups; P2 cold does not qualify for that rung", () => {
    expect(rank(input({ queue: [coldP1, overdue] })).oneThing?.kind).toBe("p1_going_cold");
    const r = rank(input({ queue: [reengage({ icp_tier: 2 }), overdue] }));
    expect(r.oneThing?.kind).toBe("overdue_follow_ups");
  });

  it("overdue rung counts every overdue task and names the top one", () => {
    const r = rank(input({ queue: [overdue, task({ overdue_days: 1, due_on: "2026-10-02", score: 10 }), task()] }));
    expect(r.oneThing?.kind).toBe("overdue_follow_ups");
    expect(r.oneThing?.text).toMatch(/^Clear 2 overdue follow-ups — start with Greystar: Call Dave back \(2d late\)/);
  });

  it("a proposal is only 'stalled big' when over the value threshold and stale", () => {
    const small = opp({ stage: "proposal_sent", value: 9_000, daysInStage: 30 });
    const fresh = opp({ stage: "proposal_sent", value: 90_000, daysInStage: 3 });
    expect(rank(input({ opportunities: [small, fresh] })).oneThing?.kind).not.toBe("stalled_proposal");
    const lateStep = opp({ stage: "negotiation", value: 90_000, daysInStage: 3, nextStepDue: "2026-10-01" });
    expect(rank(input({ opportunities: [lateStep] })).oneThing?.kind).toBe("stalled_proposal");
  });

  it("picks the highest value × urgency among stalled deals", () => {
    const a = opp({ stage: "proposal_sent", value: 60_000, daysInStage: 40, accountName: "A" });
    const b = opp({ stage: "proposal_sent", value: 200_000, daysInStage: 11, accountName: "B" });
    expect(rank(input({ opportunities: [a, b] })).oneThing?.text).toContain("B deal");
  });

  it("empty queue → no one thing, isEmpty", () => {
    const r = rank(input());
    expect(r.isEmpty).toBe(true);
    expect(r.oneThing).toBeNull();
  });
});

describe("rank — queue and counts", () => {
  it("every item has a one-line why ≤ 140 chars and counts match", () => {
    const o = opp({ nextStep: "send revised scope", nextStepDue: MON });
    const r = rank(
      input({
        queue: [task(), task({ overdue_days: 3, due_on: "2026-10-02", reason: "x".repeat(300) }), reengage({ icp_tier: 2 }), task({ item_type: "first_touch", task_id: null })],
        opportunities: [o],
        signals: [signal(), signal({ kind: "inbound_reply" })],
        extras: { newAssignments: 4 },
      }),
    );
    for (const i of r.items) {
      expect(i.why.length).toBeGreaterThan(0);
      expect(i.why.length).toBeLessThanOrEqual(140);
    }
    expect(r.due).toMatchObject({ followUps: 2, dueToday: 1, overdue: 1, reengage: 1, firstTouches: 1, opportunityNextSteps: 1 });
    expect(r.new).toMatchObject({ signals: 1, replies: 1, assignments: 4 });
    expect(r.new.topSignal).toContain("Re-roof permit filed");
  });

  it("an opportunity covered by a task is not listed twice; task why carries the deal value", () => {
    const o = opp({ nextStepDue: MON, value: 75_000, stage: "proposal_sent" });
    const r = rank(input({ queue: [task({ opportunity_id: o.id })], opportunities: [o] }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].why).toContain("$75K");
  });

  it("drops do-not-pursue accounts everywhere", () => {
    const s = signal({ accountId: "dnp" });
    const r = rank(input({ queue: [task({ account_id: "dnp" })], signals: [s], doNotPursueAccountIds: ["dnp"] }));
    expect(r.items).toHaveLength(0);
  });
});

describe("rank — escalation and snooze thresholds", () => {
  const fri = "2026-10-09";
  it("P1/P2 overdue > 3 business days escalates instead of pushing", () => {
    const p1 = task({ icp_tier: 1, due_on: MON, overdue_days: 4 }); // Mon → Fri = 4 business days
    const p2 = task({ icp_tier: 2, due_on: MON, overdue_days: 4 });
    const r = rank(input({ today: fri, queue: [p1, p2], clock: clock(fri, "08:00", 5) }));
    expect(r.escalations.map((e) => e.taskId).sort()).toEqual([p1.task_id, p2.task_id].sort());
    expect(r.escalations[0].overdueBusinessDays).toBe(4);
    expect(r.pushes).toHaveLength(0);
  });

  it("exactly 3 business days overdue is still a grouped push, not an escalation", () => {
    const thu = "2026-10-08";
    const r = rank(input({ today: thu, queue: [task({ icp_tier: 1, due_on: MON, overdue_days: 3 })], clock: clock(thu, "08:00", 4) }));
    expect(r.escalations).toHaveLength(0);
    expect(r.pushes.map((p) => p.kind)).toEqual(["overdue_group"]);
  });

  it("P3 overdue > 3 business days: badge only — no escalation, no push", () => {
    const r = rank(input({ today: fri, queue: [task({ icp_tier: 3, due_on: MON, overdue_days: 4 })], clock: clock(fri, "08:00", 5) }));
    expect(r.escalations).toHaveLength(0);
    expect(r.pushes).toHaveLength(0);
  });

  it("weekend days do not count toward business days overdue", () => {
    // Due Friday Oct 2, today Monday Oct 5: 1 business day.
    const r = rank(input({ queue: [task({ icp_tier: 1, due_on: "2026-10-02", overdue_days: 3 })], clock: clock(MON, "08:00") }));
    expect(r.items[0].overdueBusinessDays).toBe(1);
    expect(r.escalations).toHaveLength(0);
    expect(r.pushes[0].kind).toBe("overdue_group");
  });

  it("overdue > 14 days → auto-snooze prompt, never escalated or pushed", () => {
    const old = task({ icp_tier: 1, due_on: "2026-09-18", overdue_days: 17 });
    const r = rank(input({ queue: [old], clock: clock(MON, "08:00") }));
    expect(r.snoozePrompts).toEqual([expect.objectContaining({ taskId: old.task_id, overdueDays: 17 })]);
    expect(r.escalations).toHaveLength(0);
    expect(r.pushes).toHaveLength(0);
  });
});

describe("rank — push ladder", () => {
  it("due today on a P1 or ≥ $25K opp pushes at 08:00; a plain due-today task never pushes", () => {
    const big = opp({ value: 30_000 });
    const queue = [task({ icp_tier: 1 }), task({ opportunity_id: big.id }), task({ icp_tier: 3 })];
    const early = rank(input({ queue, opportunities: [big], clock: clock(MON, "07:30") }));
    expect(early.pushes).toHaveLength(2);
    expect(early.pushes.every((p) => p.kind === "due_today_big" && p.at === "08:00" && !p.dueNow)).toBe(true);
    const at8 = rank(input({ queue, opportunities: [big], clock: clock(MON, "08:00") }));
    expect(at8.pushes.every((p) => p.dueNow)).toBe(true);
  });

  it("overdue 1–3 business days are grouped into ONE push naming the top item", () => {
    const queue = [
      task({ overdue_days: 1, due_on: "2026-10-02", score: 90, account_name: "Greystar", title: "call Dave" }),
      task({ overdue_days: 1, due_on: "2026-10-02", score: 60 }),
      task({ overdue_days: 1, due_on: "2026-10-02", score: 40 }),
    ];
    const r = rank(input({ queue, clock: clock(MON, "08:10") }));
    expect(r.pushes).toHaveLength(1);
    expect(r.pushes[0]).toMatchObject({ kind: "overdue_group", dueNow: true, body: "3 overdue, top: Greystar — call Dave" });
    expect(r.pushes[0].itemKeys).toHaveLength(3);
  });

  it("caps at 3 pushes per rep per day, counting pushes already sent; replies first", () => {
    const replies = [signal({ kind: "inbound_reply" }), signal({ kind: "inbound_reply" })];
    const queue = [task({ icp_tier: 1 }), task({ overdue_days: 1, due_on: "2026-10-02" })];
    const r = rank(input({ queue, signals: replies, clock: clock(MON, "09:00") }));
    expect(r.pushes).toHaveLength(3);
    expect(r.pushes.slice(0, 2).every((p) => p.kind === "signal")).toBe(true);
    expect(r.suppressedPushes).toEqual([expect.objectContaining({ reason: "cap" })]);

    const sent = [`signal:${replies[0].id}`, `signal:${replies[1].id}`];
    const later = rank(input({ queue, signals: replies, clock: clock(MON, "09:30"), pushesSentToday: sent }));
    expect(later.pushes).toHaveLength(1);
    expect(later.suppressedPushes.filter((s) => s.reason === "already_sent")).toHaveLength(2);
    expect(rank(input({ queue, signals: replies, pushesSentToday: [...sent, "x"] })).pushes).toHaveLength(0);
  });

  it("nothing is due outside 07:00–19:00 local; a signal after 19:00 is suppressed for quiet hours", () => {
    const s = signal({ occurredAt: "2026-10-05T10:30:00Z" }); // 05:30 Chicago → clamps to 07:00
    const before = rank(input({ signals: [s], clock: clock(MON, "06:45") }));
    expect(before.pushes[0]).toMatchObject({ at: "07:00", dueNow: false });
    const after = rank(input({ signals: [s], clock: clock(MON, "19:00") }));
    expect(after.pushes[0].dueNow).toBe(false);
    const late = rank(input({ signals: [signal({ occurredAt: "2026-10-06T01:15:00Z" })], clock: clock(MON, "18:00") }));
    expect(late.pushes).toHaveLength(0);
    expect(late.suppressedPushes[0].reason).toBe("quiet_hours");
  });

  it("no pushes on weekends unless the tenant enables them", () => {
    const sat = "2026-10-10";
    const queue = [task({ icp_tier: 1, due_on: sat })];
    const off = rank(input({ today: sat, queue, clock: clock(sat, "09:00", 6) }));
    expect(off.pushes).toHaveLength(0);
    expect(off.suppressedPushes[0].reason).toBe("weekend");
    const on = rank(input({ today: sat, queue, settings: settings({ weekendReminders: true }), clock: clock(sat, "09:00", 6) }));
    expect(on.pushes).toHaveLength(1);
    expect(on.pushes[0].dueNow).toBe(true);
  });
});

describe("settings + helpers", () => {
  it("parses tenant.settings with safe defaults and never raises the push cap above 3", () => {
    const s = settingsFromTenant(TZ, { weekend_reminders: true, big_deal_usd: 50000, max_pushes_per_day: 10, quiet_hours: ["18:00", "bogus"] });
    expect(s).toMatchObject({ weekendReminders: true, bigDealUsd: 50000, maxPushesPerDay: 3, pushWindowStart: "07:00", pushWindowEnd: "18:00" });
    // The seeded tenant shape: quiet 19:00 → 07:00.
    expect(settingsFromTenant(TZ, { quiet_hours: ["19:00", "07:00"], max_pushes_per_day: 2 })).toMatchObject({
      pushWindowStart: "07:00",
      pushWindowEnd: "19:00",
      maxPushesPerDay: 2,
    });
    expect(settingsFromTenant(TZ, { quiet_hours: { start: "20:00", end: "08:30" } })).toMatchObject({ pushWindowStart: "08:30", pushWindowEnd: "20:00" });
    expect(settingsFromTenant(TZ, null).weekendReminders).toBe(false);
  });
  it("formats money and clips lines", () => {
    expect(fmtUsd(160_000)).toBe("$160K");
    expect(fmtUsd(1_250_000)).toBe("$1.3M");
    expect(fmtUsd(8_500)).toBe("$8,500");
    expect(clip("a".repeat(200))).toHaveLength(140);
  });
});
