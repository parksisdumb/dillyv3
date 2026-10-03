import { describe, expect, it } from "vitest";
import { rank } from "@/agents/rep-daily-brief/rank";
import { CLEAR_DAY, templateBrief } from "@/agents/rep-daily-brief/template";
import { MON, opp, settings, signal, task } from "./fixtures";

describe("templateBrief", () => {
  it("empty queue → clear day pointing at the field plan; still three lines", () => {
    const b = templateBrief(rank({ today: MON, queue: [], opportunities: [], signals: [], settings: settings() }));
    expect(b.source).toBe("template");
    expect(b.headline).toBe(CLEAR_DAY);
    expect(b.headline).toMatch(/field plan/);
    expect(b.lines.map((l) => l.kind)).toEqual(["one_thing", "due", "new"]);
    expect(b.lines[1].text).toBe("Due: nothing scheduled.");
    expect(b.lines[2].text).toBe("New: nothing overnight.");
  });

  it("builds one thing / due / new from the ranked facts, ≤ 140 chars each", () => {
    const r = rank({
      today: MON,
      queue: [task(), task({ overdue_days: 2, due_on: "2026-10-01" }), task({ item_type: "first_touch", task_id: null })],
      opportunities: [opp({ stage: "proposal_sent", value: 160_000, daysInStage: 18, accountName: "Greystar", nextStep: "call Dave" })],
      signals: [signal({ headline: "Hail 1.75in", accountName: "Hines" }), signal({ kind: "inbound_reply" })],
      settings: settings(),
      extras: { newAssignments: 1 },
    });
    const b = templateBrief(r, { streak: 4 });
    expect(b.headline).toContain("$160K Greystar");
    expect(b.lines[1].text).toBe("Due: 2 follow-ups (1 overdue), 1 deal next step, 1 first touch. Streak: 4 days.");
    expect(b.lines[2].text).toBe("New: 1 reply, 1 signal (Hail 1.75in — Hines), 1 account assigned.");
    for (const l of b.lines) expect(l.text.length).toBeLessThanOrEqual(140);
  });
});
