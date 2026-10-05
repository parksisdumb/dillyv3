// Post-dated touches: the Log sheet's "When" choice → touch.occurred_at, and the limits the server enforces.
// Pure (shared by the Log sheet, the server action and tests).
import { addDaysLocal, clockLabel, utcToZoned, weekdayShort, zonedToUtc } from "@/lib/domain/appointments";
import { MANAGER_ROLES, type Role } from "@/lib/domain/vocab";

export const WHEN_CHOICES = {
  now: "Now",
  earlier_today: "Earlier today",
  yesterday: "Yesterday",
  pick: "Pick date & time",
} as const;
export type WhenChoice = keyof typeof WHEN_CHOICES;

/** Reps can backdate this many days unless tenant.settings.backdate_days says otherwise. Managers+ are unlimited. */
export const DEFAULT_BACKDATE_DAYS = 30;
/** Phone clocks drift: up to this far "in the future" is accepted (and treated as now). */
export const FUTURE_SLACK_MS = 5 * 60_000;
/** A touch entered this long after it happened shows "Logged later". */
export const LOGGED_LATER_MS = 60 * 60_000;

/** Days this person may backdate a log (null = no limit). */
export function backdateLimitDays(role: Role | string | null | undefined, settings: unknown): number | null {
  if (role && (MANAGER_ROLES as string[]).includes(role)) return null;
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).backdate_days : undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_BACKDATE_DAYS;
}

export type WhenState = { choice: WhenChoice; /** HH:MM for earlier_today / yesterday */ time: string; /** YYYY-MM-DDTHH:MM for pick */ at: string };

/** Sensible starting values for each choice, in the company's zone: an hour ago today, this time yesterday, now. */
export function defaultWhen(choice: WhenChoice, now: Date, timeZone: string): WhenState {
  const nowLocal = utcToZoned(now, timeZone);
  const hourAgo = utcToZoned(new Date(now.getTime() - 3600_000), timeZone);
  const quarter = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`;
  };
  const time = choice === "earlier_today" ? (hourAgo.date === nowLocal.date ? quarter(hourAgo.time) : "00:00") : quarter(nowLocal.time);
  return { choice, time, at: `${nowLocal.date}T${nowLocal.time}` };
}

/**
 * The instant a "When" choice means, as an ISO string — null for "Now" (the server stamps it), or when the input is
 * incomplete. Wall times are read in the company's zone.
 */
export function occurredAtFor(w: WhenState, now: Date, timeZone: string): string | null {
  const today = utcToZoned(now, timeZone).date;
  try {
    switch (w.choice) {
      case "now":
        return null;
      case "earlier_today":
        return /^\d{2}:\d{2}$/.test(w.time) ? zonedToUtc(today, w.time, timeZone).toISOString() : null;
      case "yesterday":
        return /^\d{2}:\d{2}$/.test(w.time) ? zonedToUtc(addDaysLocal(today, -1), w.time, timeZone).toISOString() : null;
      case "pick": {
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(w.at);
        return m ? zonedToUtc(m[1], m[2], timeZone).toISOString() : null;
      }
    }
  } catch {
    return null;
  }
}

export type BackdateCheck = { ok: true; at: string | null } | { ok: false; error: string };

/**
 * Server-side rule for touch.occurred_at: not in the future (5-minute clock slack, which counts as now), and not
 * older than `limitDays` (null = no limit). `at` comes back null when the time is effectively now.
 */
export function checkOccurredAt(iso: string, now: Date, limitDays: number | null): BackdateCheck {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return { ok: false, error: "That date doesn't look right." };
  if (at > now.getTime() + FUTURE_SLACK_MS) return { ok: false, error: "That time is in the future. Pick when it actually happened." };
  if (limitDays != null && at < now.getTime() - limitDays * 86_400_000 - FUTURE_SLACK_MS) {
    return {
      ok: false,
      error: `Reps can log up to ${limitDays} ${limitDays === 1 ? "day" : "days"} back. Ask your manager to log anything older.`,
    };
  }
  // Within the last minute (or the clock-drift window) is just "now".
  if (at >= now.getTime() - 60_000) return { ok: true, at: null };
  return { ok: true, at: new Date(at).toISOString() };
}

/** "Tue Oct 1, 2:30 PM" in the company's zone. */
export function loggingForLabel(iso: string, timeZone: string): string {
  const { date, time } = utcToZoned(iso, timeZone);
  const md = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${weekdayShort(date)} ${md}, ${clockLabel(time)}`;
}

/** The earliest / latest a datetime-local picker allows ("YYYY-MM-DDTHH:MM", company zone). */
export function pickBounds(now: Date, timeZone: string, limitDays: number | null): { min: string | undefined; max: string } {
  const n = utcToZoned(now, timeZone);
  const max = `${n.date}T${n.time}`;
  if (limitDays == null) return { min: undefined, max };
  const m = utcToZoned(new Date(now.getTime() - limitDays * 86_400_000), timeZone);
  return { min: `${m.date}T${m.time}`, max };
}

/** Entered more than an hour after it happened. */
export function isLoggedLater(occurredAt: string, createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  return Date.parse(createdAt) - Date.parse(occurredAt) > LOGGED_LATER_MS;
}
