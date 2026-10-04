// Fixtures for the import / scorecard / bulk-assign design previews.
import fs from "node:fs";
import path from "node:path";
import { buildScorecard, type ScoreRow } from "@/lib/domain/scorecard";
import { weekStarts, monthStarts } from "@/lib/domain/scorecard";
import type { ExistingIndex } from "@/lib/domain/import/plan";

export function importFixtures(today: string) {
  const text = fs.readFileSync(path.join(process.cwd(), "docs/samples/tsg-import-sample.csv"), "utf8");
  const members = [
    { user_id: "00000000-0000-4000-8000-0000000000a1", email: "team@dillyos.com", name: "Parks Flowers", role: "owner" },
    { user_id: "00000000-0000-4000-8000-0000000000a2", email: "morgan@example.com", name: "Morgan Hale", role: "rep" },
  ];
  const index: ExistingIndex = {
    accounts: [{ id: "00000000-0000-4000-8000-0000000000b1", name: "Wolf River Commercial", normalized_name: "wolf river commercial", owner_user_id: members[1]!.user_id }],
    contacts: [{ id: "00000000-0000-4000-8000-0000000000c1", full_name: "Paige Stanfield", email: "paige.stanfield@example.com", phone_digits: null, account_id: "00000000-0000-4000-8000-0000000000b1" }],
    properties: [
      { id: "00000000-0000-4000-8000-0000000000d1", name: "Poplar Corridor Plaza", address1: "5100 Poplar Ave", city: "Memphis", normalized_address: "5100 poplar ave memphis", account_id: "00000000-0000-4000-8000-0000000000b1" },
    ],
  };

  // Scorecard: three reps, 13 weeks of plausible numbers (deterministic).
  const reps = [
    { user_id: "00000000-0000-4000-8000-0000000000e1", name: "Colby Remedios" },
    { user_id: "00000000-0000-4000-8000-0000000000e2", name: "Kayla Smiley" },
    { user_id: "00000000-0000-4000-8000-0000000000e3", name: "Tyler Fox" },
  ];
  const weeks = weekStarts(today);
  const { thisMonth, lastMonth } = monthStarts(today);
  const rows: ScoreRow[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const [ri, r] of reps.entries()) {
    const months = new Map<string, ScoreRow>();
    weeks.forEach((w, i) => {
      const ramp = 0.6 + i / 20;
      const row: ScoreRow = {
        user_id: r.user_id,
        bucket: "week",
        period_start: w,
        meetings: Math.round((2 + rnd() * 3) * ramp) - ri,
        in_person: Math.round((7 + rnd() * 6) * ramp) - ri * 2,
        first_touches: Math.round((4 + rnd() * 5) * ramp),
        fu_due: 14,
        fu_done: Math.min(14, Math.round(10 + rnd() * 4 * ramp)),
        paperwork: rnd() > 0.7 ? 1 : 0,
      };
      rows.push(row);
      const m = i === weeks.length - 1 ? thisMonth : w.slice(0, 7) + "-01";
      if (m === thisMonth || m === lastMonth) {
        const cur = months.get(m) ?? { user_id: r.user_id, bucket: "month", period_start: m, meetings: 0, in_person: 0, first_touches: 0, fu_due: 0, fu_done: 0, paperwork: 0 };
        for (const k of ["meetings", "in_person", "first_touches", "fu_due", "fu_done", "paperwork"] as const) cur[k] = (cur[k] ?? 0) + (row[k] ?? 0);
        months.set(m, cur);
      }
    });
    rows.push(...months.values());
  }
  const scorecard = buildScorecard(rows, reps, today, { meetings_month: 30, paperwork_month: 4, in_person_rep_week: 10, first_touches_month: 60, follow_up_pct: 90 });
  return { text, members, index, scorecard, me: members[0]!.user_id };
}
