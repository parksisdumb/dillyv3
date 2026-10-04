/**
 * Notification copy for reminder pushes: short, specific, and tappable to the exact item.
 *   due_today_big  "Call Dave back — Greystar Riverside" → /app/accounts/<id>
 *   signal         "Greystar: replied to your proposal"  → /app/accounts/<id>
 *   overdue_group  "3 overdue follow-ups"                 → /app/today
 *   appointment    "9:00 · Inspection · Greystar"         → /app/appointments/<id>
 * The ladder (what, when, how many) is decided in rank.ts; this only words it.
 */
import type { PushDecision, RankedItem } from "@/agents/rep-daily-brief/rank";

export type PushPayload = {
  title: string;
  body: string;
  /** Same-origin path the notification opens. */
  url: string;
  /** Collapses repeats on the device (same reminder twice → one notification). */
  tag: string;
};

type ItemLite = Pick<RankedItem, "key" | "type" | "title" | "accountId" | "accountName" | "opportunityId">;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The screen a reminder item opens: its account, its opportunity, or Today. */
export function itemUrl(item: ItemLite | undefined): string {
  if (!item) return "/app/today";
  if (item.type === "opportunity" && item.opportunityId) return `/app/pipeline/${item.opportunityId}`;
  if (item.accountId) return `/app/accounts/${item.accountId}`;
  if (item.opportunityId) return `/app/pipeline/${item.opportunityId}`;
  return "/app/today";
}

export function notificationFor(push: PushDecision, items: Map<string, ItemLite> | ItemLite[] = []): PushPayload {
  const byKey = items instanceof Map ? items : new Map(items.map((i) => [i.key, i]));
  const first = byKey.get(push.itemKeys[0] ?? "");
  const tag = `dilly:${push.key}`;
  switch (push.kind) {
    case "due_today_big":
      return {
        title: clip(first ? (first.accountName ? `${first.title} — ${first.accountName}` : first.title) : push.title, 80),
        body: clip(push.body, 120),
        url: itemUrl(first),
        tag,
      };
    case "signal":
      return { title: clip(push.title, 80), body: clip(push.body, 120), url: itemUrl(first), tag };
    case "appointment":
      // Key is "appt:<id>": open the appointment (stops, directions, Log outcome).
      return { title: clip(push.title, 80), body: clip(push.body, 120), url: `/app/appointments/${push.key.slice(5)}`, tag };
    case "overdue_group": {
      const n = push.itemKeys.length;
      return { title: n === 1 ? "1 overdue follow-up" : `${n} overdue follow-ups`, body: clip(push.body, 120), url: "/app/today", tag };
    }
    default:
      return { title: clip(push.title, 80), body: clip(push.body, 120), url: itemUrl(first), tag };
  }
}
