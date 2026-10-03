/**
 * Tenant-local time helpers. Every schedule in Dilly is expressed in the tenant's timezone
 * (tenant.timezone); crons fire in UTC and filter with these.
 * Dates are ISO `YYYY-MM-DD` strings so they round-trip with Postgres `date` columns.
 */

export interface LocalClock {
  /** Tenant-local calendar date, YYYY-MM-DD. */
  date: string;
  hour: number;
  minute: number;
  /** ISO day of week: 1 = Monday … 7 = Sunday. */
  isoDow: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localClock(timeZone: string, at: Date = new Date()): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    isoDow: WEEKDAYS[get("weekday")] ?? 1,
  };
}

function parseDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function isoDow(date: string): number {
  const dow = parseDate(date).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function isWeekend(date: string): boolean {
  return isoDow(date) >= 6;
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

/** Weekdays in (from, to]. A task due Friday is 1 business day overdue on Monday. */
export function businessDaysBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  let d = from;
  while (d < to) {
    d = addDays(d, 1);
    if (!isWeekend(d)) n++;
  }
  return n;
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoDow(date));
}

/** "HH:MM" → minutes after midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
