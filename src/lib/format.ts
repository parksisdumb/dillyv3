// Pure formatting helpers (no server imports — usable in client components and tests).

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for `at` in the given IANA time zone. */
export function localDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Parse YYYY-MM-DD as a UTC-midnight Date (date-only arithmetic, no tz drift). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return dayString(new Date(parseDay(day).getTime() + n * DAY_MS));
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((parseDay(toDay).getTime() - parseDay(fromDay).getTime()) / DAY_MS);
}

/** Next weekday after `day` (Fri → Mon). */
export function nextBusinessDay(day: string, n = 1): string {
  let d = day;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const dow = parseDay(d).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const dow = parseDay(day).getUTCDay(); // 0 Sun
  return addDays(day, -((dow + 6) % 7));
}

export function monthStart(day: string): string {
  return day.slice(0, 8) + "01";
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Tomorrow", "Thu", "Oct 12" — field language for a due date. */
export function dueLabel(due: string, today: string): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = parseDay(due);
  if (diff > 1 && diff < 7) return WEEKDAY[d.getUTCDay()];
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDay(iso.slice(0, 10));
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "3 days late" / "1 day late". */
export function lateLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"} late`;
}

/** "Touched today", "Quiet 22 days", "Never touched". */
export function quietLabel(days: number | null | undefined, lastTouch: string | null | undefined): string {
  if (!lastTouch) return "Never touched";
  if (days == null || days <= 0) return "Touched today";
  if (days === 1) return "Touched yesterday";
  return `Quiet ${days} days`;
}

/** Relative time for a timestamp: "2h ago", "Mon", "Sep 3". */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const mins = Math.round((now.getTime() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(iso);
}

export function money(n: number | null | undefined, compact = true): string {
  if (n == null) return "—";
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    return `$${Math.round(n / 1000)}K`;
  }
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

/** Toast after a log: "+4 · follow-up closed · next: Call Dave back Thu". */
export function logToast(input: {
  points: number;
  closed: number;
  next: { title: string; due_on: string } | null;
  today: string;
}): string {
  const parts: string[] = [];
  parts.push(input.points > 0 ? `+${input.points}` : "Logged");
  if (input.closed === 1) parts.push("follow-up closed");
  else if (input.closed > 1) parts.push(`${input.closed} follow-ups closed`);
  if (input.next) parts.push(`next: ${input.next.title} ${dueLabel(input.next.due_on, input.today)}`);
  else parts.push("no follow-up set");
  return parts.join(" · ");
}

export function mapsUrl(parts: (string | null | undefined)[]): string | null {
  const q = parts.filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

/** Minutes east of UTC for `timeZone` at instant `at` (e.g. America/Chicago in October → -300). */
export function tzOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** ISO timestamp of local midnight starting `day` in `timeZone`. */
export function dayStartISO(day: string, timeZone: string): string {
  const utcMidnight = parseDay(day).getTime();
  const off = tzOffsetMinutes(timeZone, new Date(utcMidnight + 12 * 3600_000));
  return new Date(utcMidnight - off * 60000).toISOString();
}

/** "2:14 PM" (or "Oct 3, 2:14 PM" when not today) in the phone's own zone — for things the phone itself recorded. */
export function timeOfDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}
