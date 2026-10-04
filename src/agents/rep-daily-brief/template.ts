/**
 * Deterministic three-line brief. Used when the LLM is absent (no ANTHROPIC_API_KEY), fails,
 * or its draft grades worse than C — a rep never gets a bad or missing brief.
 */
import { clip, type Ranked } from "./rank";

export type BriefLineKind = "one_thing" | "due" | "new";

export interface BriefContent {
  headline: string;
  lines: { kind: BriefLineKind; text: string }[];
  source: "llm" | "template";
}

export const CLEAR_DAY = "Clear day — nothing due. Go build the book: work today's field plan.";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function dueLine(r: Ranked, streak?: number | null): string {
  const d = r.due;
  const parts: string[] = [];
  // Appointments lead the Due line: they're fixed in time.
  if (d.appointments && d.firstMeetingAt) parts.push(`${plural(d.appointments, "appointment")} (first ${d.firstMeetingAt})`);
  if (d.followUps) parts.push(`${plural(d.followUps, "follow-up")}${d.overdue ? ` (${d.overdue} overdue)` : ""}`);
  if (d.opportunityNextSteps) parts.push(plural(d.opportunityNextSteps, "deal next step"));
  if (d.reengage) parts.push(plural(d.reengage, "re-engage"));
  if (d.firstTouches) parts.push(plural(d.firstTouches, "first touch", "first touches"));
  if (d.routeStops) parts.push(plural(d.routeStops, "route stop"));
  if (d.firstMeetingAt && !d.appointments) parts.push(`first meeting ${d.firstMeetingAt}`);
  let line = parts.length ? `Due: ${parts.join(", ")}.` : "Due: nothing scheduled.";
  if (streak && streak > 1) line += ` Streak: ${streak} days.`;
  return clip(line);
}

export function newLine(r: Ranked): string {
  const n = r.new;
  const parts: string[] = [];
  if (n.replies) parts.push(plural(n.replies, "reply", "replies"));
  if (n.signals) parts.push(`${plural(n.signals, "signal")}${n.topSignal ? ` (${n.topSignal})` : ""}`);
  if (n.assignments) parts.push(plural(n.assignments, "account assigned", "accounts assigned"));
  return clip(parts.length ? `New: ${parts.join(", ")}.` : "New: nothing overnight.");
}

export function templateBrief(r: Ranked, opts: { streak?: number | null } = {}): BriefContent {
  const oneThing = r.isEmpty || !r.oneThing ? CLEAR_DAY : r.oneThing.text;
  return {
    headline: clip(oneThing),
    lines: [
      { kind: "one_thing", text: clip(oneThing) },
      { kind: "due", text: dueLine(r, opts.streak) },
      { kind: "new", text: newLine(r) },
    ],
    source: "template",
  };
}
