// Mirrors the point awards in app.on_touch_insert() so buttons can show what an outcome is worth before the tap.
// The database is still the source of truth — the toast reads back the real point_event rows.
import type { Channel, Outcome, PersonaRole } from "@/lib/domain/vocab";

export const CONNECT_OUTCOMES: Outcome[] = ["connected", "met_in_person", "met_decision_maker", "replied", "call_back_later"];
export const IN_PERSON_CHANNELS: Channel[] = ["door_knock", "site_visit", "inspection", "roof_walk", "lunch_and_learn", "event", "meeting"];

export type PointRules = Record<string, number>;

/** Platform defaults (20261003000700_reference_data.sql); tenant overrides are merged on top by the caller. */
export const DEFAULT_POINTS: PointRules = {
  touch_logged: 1,
  connect: 3,
  decision_maker_conversation: 6,
  field_contact_created: 4,
  follow_up_on_time: 3,
  clean_week: 5,
  inspection_booked: 10,
  site_walk_completed: 12,
  bid_requested: 15,
  proposal_delivered: 20,
  onboarding_step: 15,
  lunch_and_learn: 25,
  won: 50,
  cold_rescued: 5,
};

/** Merge point_rule rows: tenant rows override platform (tenant_id null) rows. */
export function mergePointRules(rows: { tenant_id: string | null; event: string; points: number }[]): PointRules {
  const out: PointRules = { ...DEFAULT_POINTS };
  for (const r of rows.filter((r) => r.tenant_id == null)) out[r.event] = r.points;
  for (const r of rows.filter((r) => r.tenant_id != null)) out[r.event] = r.points;
  return out;
}

/** Points a first touch of the day on a contact/account would earn (excludes on-time follow-up and cold-rescue bonuses). */
export function previewPoints(channel: Channel, outcome: Outcome, metRole: PersonaRole | null, rules: PointRules): number {
  let p = rules.touch_logged ?? 0;
  if (CONNECT_OUTCOMES.includes(outcome)) p += rules.connect ?? 0;
  if (outcome === "met_decision_maker" || metRole === "economic_buyer" || metRole === "evaluator")
    p += rules.decision_maker_conversation ?? 0;
  if (outcome === "scheduled_inspection") p += rules.inspection_booked ?? 0;
  if (outcome === "bid_requested") p += rules.bid_requested ?? 0;
  if (channel === "lunch_and_learn") p += rules.lunch_and_learn ?? 0;
  return p;
}
