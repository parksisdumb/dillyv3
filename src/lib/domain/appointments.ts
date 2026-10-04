// Appointments — pure helpers (no server imports; used by client components, route handlers and tests).
// Times: appointments are stored as timestamptz; reps pick a date + time in the COMPANY's time zone (tenant.timezone).
import type { Channel } from "@/lib/domain/vocab";

export const APPT_KINDS = {
  inspection: { label: "Inspection", channel: "inspection", minutes: 60 },
  roof_walk: { label: "Roof walk", channel: "roof_walk", minutes: 60 },
  meeting: { label: "Meeting", channel: "meeting", minutes: 60 },
  lunch_and_learn: { label: "Lunch & learn", channel: "lunch_and_learn", minutes: 60 },
  site_visit: { label: "Site visit", channel: "site_visit", minutes: 30 },
  call: { label: "Call", channel: "call", minutes: 15 },
  other: { label: "Other", channel: "other", minutes: 30 },
} as const satisfies Record<string, { label: string; channel: Channel; minutes: number }>;
export type ApptKind = keyof typeof APPT_KINDS;
export const APPT_KIND_KEYS = Object.keys(APPT_KINDS) as ApptKind[];

export const APPT_STATUS = { scheduled: "Scheduled", done: "Done", canceled: "Canceled", no_show: "No-show" } as const;
export type ApptStatus = keyof typeof APPT_STATUS;

export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
export const REMINDERS = [0, 15, 30, 60, 120, 1440] as const;

export function isApptKind(k: unknown): k is ApptKind {
  return typeof k === "string" && k in APPT_KINDS;
}

/** The touch channel an appointment's outcome is logged on by default. */
export function channelForKind(kind: string): Channel {
  return isApptKind(kind) ? APPT_KINDS[kind].channel : "meeting";
}

/** Booking one of these is "inspection booked" (points). */
export const BOOKING_KINDS: ApptKind[] = ["inspection", "roof_walk"];

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function reminderLabel(min: number): string {
  if (min === 0) return "No reminder";
  if (min === 1440) return "Day before";
  return `${durationLabel(min)} before`;
}

// ---------------------------------------------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------------------------------------------

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(timeZone: string, at: Date): Parts {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Minutes east of UTC for `timeZone` at instant `at`. */
export function offsetMinutes(timeZone: string, at: Date): number {
  const p = partsIn(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Local wall time ("2026-10-06" + "09:00" in America/Chicago) → the UTC instant. DST-safe: the offset is taken at
 * the resulting instant (a second pass fixes the hour around a transition). A time that doesn't exist (spring
 * forward 2:30) lands an hour later, as phones do.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) throw new Error(`bad local time ${date} ${time}`);
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  t = wall - offsetMinutes(timeZone, new Date(t)) * 60000;
  const back = utcToZoned(new Date(t), timeZone);
  if (back.date !== date || back.time !== time) {
    // In the spring-forward gap: move forward by the size of the gap.
    const gap = offsetMinutes(timeZone, new Date(t + 3 * 3600_000)) - offsetMinutes(timeZone, new Date(t - 3 * 3600_000));
    t += gap * 60000;
  }
  return new Date(t);
}

/** The local date (YYYY-MM-DD) and time (HH:MM) of an instant in `timeZone`. */
export function utcToZoned(at: Date | string, timeZone: string): { date: string; time: string } {
  const p = partsIn(timeZone, typeof at === "string" ? new Date(at) : at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** "2026-10-06" → "Tue". */
export function weekdayShort(date: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** "09:00" → "9:00 AM"; "13:30" → "1:30 PM". */
export function clockLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Today", "Tomorrow", "Tue Oct 6". */
export function dayLabel(date: string, today: string): string {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = new Date(`${date}T12:00:00Z`);
  return `${weekdayShort(date)} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/** "Today 9:00 AM" / "Tue Oct 6 · 9:00 AM" / "Tue Oct 6 · all day" in the company's zone. */
export function whenLabel(startsAt: string, allDay: boolean, timeZone: string, today: string): string {
  const { date, time } = utcToZoned(startsAt, timeZone);
  const day = dayLabel(date, today);
  return allDay ? `${day} · all day` : `${day} · ${clockLabel(time)}`;
}

/**
 * Default date + time for a new appointment: the next whole hour from now in the company's zone, kept inside
 * 7 AM–5 PM working hours — before 7 → 9 AM today; from 5 PM on → 9 AM the next weekday. Weekends → Monday 9 AM.
 */
export function defaultStart(now: Date, timeZone: string): { date: string; time: string } {
  const p = partsIn(timeZone, now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const next = p.hour + 1;
  if (dow !== 0 && dow !== 6 && p.hour < 7) return { date, time: "09:00" };
  if (dow !== 0 && dow !== 6 && next <= 17 && next >= 8) return { date, time: `${pad(next)}:00` };
  // Next weekday at 9.
  let d = date;
  do {
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  } while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
  return { date: d, time: "09:00" };
}

/** Round a HH:MM to the 15-minute grid the time picker uses. */
export function snapQuarter(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(Math.round((h * 60 + m) / 15) * 15, 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Date `n` days after `date`, and "next <weekday>" helpers for tests/UI. */
export function addDaysLocal(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export function nextWeekday(today: string, isoDow: number): string {
  const dow = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const diff = (isoDow - dow + 7) % 7 || 7;
  return addDaysLocal(today, diff);
}

// ---------------------------------------------------------------------------------------------------------------
// Add to calendar: Google Calendar template link + iCalendar (.ics)
// ---------------------------------------------------------------------------------------------------------------

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  timeZone: string;
  /** Absolute URL of the appointment page (goes in the description / URL property). */
  url?: string | null;
  updatedAt?: string | null;
  status?: string;
};

const DEFAULT_MINUTES = 60;

function endOf(e: CalendarEvent): Date {
  return e.endsAt ? new Date(e.endsAt) : new Date(Date.parse(e.startsAt) + DEFAULT_MINUTES * 60000);
}

/** 20261006T140000Z */
export function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** 20261006T090000 (local wall time, for DTSTART;TZID=…). */
export function icsLocal(at: Date | string, timeZone: string): string {
  const { date, time } = utcToZoned(at, timeZone);
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title });
  if (e.allDay) {
    const d = utcToZoned(e.startsAt, e.timeZone).date;
    const end = e.endsAt ? utcToZoned(e.endsAt, e.timeZone).date : d;
    q.set("dates", `${d.replace(/-/g, "")}/${addDaysLocal(end, 1).replace(/-/g, "")}`);
  } else {
    q.set("dates", `${icsUtc(new Date(e.startsAt))}/${icsUtc(endOf(e))}`);
  }
  const details = [e.description, e.url].filter(Boolean).join("\n\n");
  if (details) q.set("details", details);
  if (e.location) q.set("location", e.location);
  q.set("ctz", e.timeZone);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** RFC 5545 TEXT escaping. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Fold lines at 75 octets (RFC 5545 §3.1). */
export function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${String(a % 60).padStart(2, "0")}`;
}

/**
 * VTIMEZONE for the event's zone. US zones (every Dilly tenant today) follow the 2007+ rule: DST from the second
 * Sunday of March 02:00 to the first Sunday of November 02:00; a zone without DST (America/Phoenix) gets a single
 * STANDARD block. Offsets are read from the platform's tz database for the event's year.
 */
export function vtimezone(timeZone: string, year: number): string[] {
  const jan = offsetMinutes(timeZone, new Date(Date.UTC(year, 0, 15, 12)));
  const jul = offsetMinutes(timeZone, new Date(Date.UTC(year, 6, 15, 12)));
  const std = Math.min(jan, jul);
  const dst = Math.max(jan, jul);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  if (std === dst) {
    lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${fmtOffset(std)}`, `TZOFFSETTO:${fmtOffset(std)}`, "END:STANDARD");
  } else {
    lines.push(
      "BEGIN:DAYLIGHT",
      "DTSTART:20070311T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      `TZOFFSETFROM:${fmtOffset(std)}`,
      `TZOFFSETTO:${fmtOffset(dst)}`,
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:20071104T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      `TZOFFSETFROM:${fmtOffset(dst)}`,
      `TZOFFSETTO:${fmtOffset(std)}`,
      "END:STANDARD",
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/** A complete .ics file (CRLF line endings) with one VEVENT in the company's zone. */
export function buildIcs(e: CalendarEvent, now: Date = new Date()): string {
  const start = new Date(e.startsAt);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dilly//Appointments//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (!e.allDay) lines.push(...vtimezone(e.timeZone, Number(utcToZoned(start, e.timeZone).date.slice(0, 4))));
  lines.push("BEGIN:VEVENT", `UID:${e.id}@dilly`, `DTSTAMP:${icsUtc(now)}`);
  if (e.allDay) {
    const d = utcToZoned(start, e.timeZone).date;
    const end = e.endsAt ? utcToZoned(e.endsAt, e.timeZone).date : d;
    lines.push(`DTSTART;VALUE=DATE:${d.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDaysLocal(end, 1).replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART;TZID=${e.timeZone}:${icsLocal(start, e.timeZone)}`, `DTEND;TZID=${e.timeZone}:${icsLocal(endOf(e), e.timeZone)}`);
  }
  lines.push(`SUMMARY:${icsEscape(e.title)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  const desc = [e.description, e.url].filter(Boolean).join("\n\n");
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${icsUtc(new Date(e.updatedAt))}`);
  lines.push(`STATUS:${e.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** Safe file name: "inspection-greystar-riverside.ics". */
export function icsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "appointment"}.ics`;
}

/** Title the sheet suggests: "Inspection · Greystar Riverside (3 buildings)". */
export function suggestTitle(kind: ApptKind, place: string | null, buildings: number): string {
  const what = APPT_KINDS[kind].label;
  if (!place) return what;
  return buildings > 1 ? `${what} · ${place} (${buildings} buildings)` : `${what} · ${place}`;
}
