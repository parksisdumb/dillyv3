import { z } from "zod";

/**
 * Optional monthly team goal stored in tenant.settings.team_goal, e.g.
 *   { "label": "Inspections booked", "event": "inspection_booked", "target": 20 }
 * Progress = point_event rows of that event across the tenant this month.
 */
export const teamGoalSchema = z.object({
  label: z.string().trim().min(1).max(60),
  event: z.string().trim().min(1).max(60),
  target: z.coerce.number().int().positive().max(100000),
});
export type TeamGoal = z.infer<typeof teamGoalSchema>;

export function parseTeamGoal(settings: unknown): TeamGoal | null {
  if (!settings || typeof settings !== "object") return null;
  const g = (settings as Record<string, unknown>).team_goal;
  const r = teamGoalSchema.safeParse(g);
  return r.success ? r.data : null;
}

export const GOAL_EVENTS: Record<string, string> = {
  inspection_booked: "Inspections booked",
  bid_requested: "Bids requested",
  decision_maker_conversation: "Decision-maker conversations",
  lunch_and_learn: "Lunch & learns",
  proposal_delivered: "Proposals delivered",
  won: "Jobs won",
  field_contact_created: "New field contacts",
};
