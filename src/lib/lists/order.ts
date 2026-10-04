// Working-list ordering for Go (pure; see working-list.ts for the data side).
//   1. My ACTIVE pursuits — stale first (no touch in STALE_DAYS, oldest first), then the rest, least recently touched first.
//   2. Buildings from lists assigned to me that nobody has touched in UNTOUCHED_DAYS, in list order.
//   Excluded buildings (do-not-pursue / competitor accounts, an appointment today, …) never appear. Capped.

export const WORKING_CAP = 25;
export const STALE_DAYS = 21;
export const UNTOUCHED_DAYS = 14;

const DAY = 86_400_000;

export type ActiveIn = { propertyId: string; startedAt: string; lastTouchAt: string | null };
export type ListItemIn = { propertyId: string; listId: string; listName: string; lastTouchAt: string | null };

export type WorkingOrderItem = {
  propertyId: string;
  source: "active" | "list";
  listName: string | null;
  stale: boolean;
  lastTouchAt: string | null;
  /** Days since the last touch (null = never touched). */
  quietDays: number | null;
  reason: string;
};

function daysAgo(iso: string | null, now: Date): number | null {
  return iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)) : null;
}

/** An active pursuit is stale when nobody has touched the building in STALE_DAYS (counted from the start if never). */
export function isStaleActive(a: Pick<ActiveIn, "startedAt" | "lastTouchAt">, now: Date, staleDays = STALE_DAYS): boolean {
  const ref = a.lastTouchAt && Date.parse(a.lastTouchAt) > Date.parse(a.startedAt) ? a.lastTouchAt : a.startedAt;
  return (daysAgo(ref, now) ?? 0) > staleDays;
}

function quiet(days: number | null): string {
  if (days == null) return "never touched";
  if (days === 0) return "touched today";
  return `quiet ${days}d`;
}

export function orderWorkingList(
  active: ActiveIn[],
  listItems: ListItemIn[],
  opts: { now: Date; exclude?: Set<string>; cap?: number; staleDays?: number; untouchedDays?: number },
): WorkingOrderItem[] {
  const cap = opts.cap ?? WORKING_CAP;
  const staleDays = opts.staleDays ?? STALE_DAYS;
  const untouched = opts.untouchedDays ?? UNTOUCHED_DAYS;
  const exclude = opts.exclude ?? new Set<string>();
  const seen = new Set<string>();
  const out: WorkingOrderItem[] = [];

  const act = active
    .filter((a) => !exclude.has(a.propertyId))
    .map((a) => ({ a, stale: isStaleActive(a, opts.now, staleDays), t: a.lastTouchAt ?? "" }))
    // stale first; within each group least recently touched first (never touched = oldest); then oldest pursuit.
    .sort((x, y) => Number(y.stale) - Number(x.stale) || x.t.localeCompare(y.t) || x.a.startedAt.localeCompare(y.a.startedAt));
  for (const { a, stale } of act) {
    if (seen.has(a.propertyId)) continue;
    seen.add(a.propertyId);
    const d = daysAgo(a.lastTouchAt, opts.now);
    out.push({
      propertyId: a.propertyId,
      source: "active",
      listName: null,
      stale,
      lastTouchAt: a.lastTouchAt,
      quietDays: d,
      reason: stale ? `Active · going stale — ${quiet(d)}` : `Active · ${quiet(d)}`,
    });
  }

  for (const it of listItems) {
    if (out.length >= cap) break;
    if (seen.has(it.propertyId) || exclude.has(it.propertyId)) continue;
    const d = daysAgo(it.lastTouchAt, opts.now);
    if (d != null && d < untouched) continue;
    seen.add(it.propertyId);
    out.push({ propertyId: it.propertyId, source: "list", listName: it.listName, stale: false, lastTouchAt: it.lastTouchAt, quietDays: d, reason: `${it.listName} · ${quiet(d)}` });
  }
  return out.slice(0, cap);
}
