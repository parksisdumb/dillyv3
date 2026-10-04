import { describe, expect, it } from "vitest";
import {
  buildIcs,
  channelForKind,
  clockLabel,
  dayLabel,
  defaultStart,
  googleCalendarUrl,
  icsFileName,
  icsFold,
  nextWeekday,
  snapQuarter,
  suggestTitle,
  utcToZoned,
  vtimezone,
  zonedToUtc,
  type CalendarEvent,
} from "@/lib/domain/appointments";
import { routeWithFixedFirst } from "@/lib/geo/route";

const TZ = "America/Chicago";

describe("time zones", () => {
  it("local wall time in Chicago → UTC, across DST", () => {
    expect(zonedToUtc("2026-10-06", "09:00", TZ).toISOString()).toBe("2026-10-06T14:00:00.000Z"); // CDT
    expect(zonedToUtc("2026-12-01", "09:00", TZ).toISOString()).toBe("2026-12-01T15:00:00.000Z"); // CST
    expect(zonedToUtc("2026-11-01", "01:30", TZ).toISOString()).toMatch(/^2026-11-01T0[67]:30:00/); // ambiguous hour
    expect(zonedToUtc("2027-03-14", "02:30", TZ).toISOString()).toBe("2027-03-14T08:30:00.000Z"); // doesn't exist → 3:30 CDT
    expect(() => zonedToUtc("2026-10-06", "9am", TZ)).toThrow();
  });
  it("round-trips", () => {
    expect(utcToZoned("2026-10-06T14:00:00.000Z", TZ)).toEqual({ date: "2026-10-06", time: "09:00" });
    expect(utcToZoned("2026-10-07T03:30:00.000Z", TZ)).toEqual({ date: "2026-10-06", time: "22:30" });
  });
  it("labels", () => {
    expect(clockLabel("09:00")).toBe("9:00 AM");
    expect(clockLabel("13:30")).toBe("1:30 PM");
    expect(clockLabel("00:15")).toBe("12:15 AM");
    expect(dayLabel("2026-10-05", "2026-10-05")).toBe("Today");
    expect(dayLabel("2026-10-06", "2026-10-05")).toBe("Tomorrow");
    expect(dayLabel("2026-10-13", "2026-10-05")).toBe("Tue Oct 13");
    expect(nextWeekday("2026-10-05", 2)).toBe("2026-10-06"); // Mon → next Tuesday
    expect(nextWeekday("2026-10-06", 2)).toBe("2026-10-13"); // Tue → the Tuesday after
  });
});

describe("default start (next whole hour, working hours, weekdays)", () => {
  const at = (iso: string) => defaultStart(new Date(iso), TZ);
  it("next hour during the day", () => {
    expect(at("2026-10-05T15:20:00Z")).toEqual({ date: "2026-10-05", time: "11:00" }); // Mon 10:20 CDT
    expect(at("2026-10-05T12:59:00Z")).toEqual({ date: "2026-10-05", time: "08:00" }); // Mon 7:59
  });
  it("before 7 → 9 AM today; from 5 PM → 9 AM next weekday; weekend → Monday", () => {
    expect(at("2026-10-05T10:00:00Z")).toEqual({ date: "2026-10-05", time: "09:00" }); // Mon 5:00
    expect(at("2026-10-05T22:10:00Z")).toEqual({ date: "2026-10-06", time: "09:00" }); // Mon 17:10
    expect(at("2026-10-09T23:00:00Z")).toEqual({ date: "2026-10-12", time: "09:00" }); // Fri 18:00
    expect(at("2026-10-10T16:00:00Z")).toEqual({ date: "2026-10-12", time: "09:00" }); // Sat
  });
  it("snaps to 15 minutes", () => {
    expect(snapQuarter("09:07")).toBe("09:00");
    expect(snapQuarter("09:08")).toBe("09:15");
    expect(snapQuarter("23:59")).toBe("23:45");
  });
});

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "4f0c2c4e-0000-4000-8000-000000000001",
  title: "Inspection · Greystar Riverside (3 buildings)",
  startsAt: "2026-10-06T14:00:00.000Z",
  endsAt: "2026-10-06T15:30:00.000Z",
  allDay: false,
  location: "1801 S Pleasant Valley Rd, Austin, TX",
  description: "1. Bldg A\n2. Bldg B; gate 4411",
  timeZone: TZ,
  url: "https://app.dillyos.com/app/appointments/4f0c2c4e-0000-4000-8000-000000000001",
  ...over,
});

describe("Google Calendar link", () => {
  it("template URL with UTC times, location, details and the company zone", () => {
    const u = new URL(googleCalendarUrl(ev()));
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe("Inspection · Greystar Riverside (3 buildings)");
    expect(u.searchParams.get("dates")).toBe("20261006T140000Z/20261006T153000Z");
    expect(u.searchParams.get("location")).toBe("1801 S Pleasant Valley Rd, Austin, TX");
    expect(u.searchParams.get("details")).toContain("gate 4411");
    expect(u.searchParams.get("details")).toContain("/app/appointments/");
    expect(u.searchParams.get("ctz")).toBe(TZ);
  });
  it("no end → 1 hour; all day → date range (end exclusive)", () => {
    expect(new URL(googleCalendarUrl(ev({ endsAt: null }))).searchParams.get("dates")).toBe("20261006T140000Z/20261006T150000Z");
    expect(new URL(googleCalendarUrl(ev({ allDay: true, startsAt: "2026-10-06T05:00:00.000Z", endsAt: null }))).searchParams.get("dates")).toBe("20261006/20261007");
  });
});

describe(".ics", () => {
  const ics = buildIcs(ev(), new Date("2026-10-04T12:00:00Z"));
  const lines = ics.split("\r\n");
  it("CRLF, one VEVENT with DTSTART/DTEND in local time + TZID", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("DTSTART;TZID=America/Chicago:20261006T090000");
    expect(lines).toContain("DTEND;TZID=America/Chicago:20261006T103000");
    expect(lines).toContain("UID:4f0c2c4e-0000-4000-8000-000000000001@dilly");
    expect(lines).toContain("DTSTAMP:20261004T120000Z");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
  it("VTIMEZONE for Chicago: CDT −0500 from 2nd Sunday of March, CST −0600 from 1st Sunday of November", () => {
    const tz = vtimezone(TZ, 2026).join("\n");
    expect(tz).toContain("TZID:America/Chicago");
    expect(tz).toMatch(/BEGIN:DAYLIGHT\nDTSTART:20070311T020000\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\nTZOFFSETFROM:-0600\nTZOFFSETTO:-0500/);
    expect(tz).toMatch(/BEGIN:STANDARD\nDTSTART:20071104T020000\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0600/);
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(vtimezone("America/Phoenix", 2026).join("\n")).not.toContain("DAYLIGHT");
  });
  it("escapes text, folds long lines, cancel → CANCELLED, all-day uses VALUE=DATE", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:1. Bldg A\\n2. Bldg B\\; gate 4411");
    expect(unfolded).toContain("LOCATION:1801 S Pleasant Valley Rd\\, Austin\\, TX");
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(icsFold("x".repeat(160)).split("\r\n ").map((p) => p.length)).toEqual([75, 74, 11]);
    expect(buildIcs(ev({ status: "canceled" }))).toContain("STATUS:CANCELLED");
    const allDay = buildIcs(ev({ allDay: true, startsAt: "2026-10-06T05:00:00.000Z", endsAt: null }));
    expect(allDay).toContain("DTSTART;VALUE=DATE:20261006");
    expect(allDay).toContain("DTEND;VALUE=DATE:20261007");
    expect(allDay).not.toContain("VTIMEZONE");
  });
  it("file name", () => {
    expect(icsFileName("Inspection · Greystar Riverside (3 buildings)")).toBe("inspection-greystar-riverside-3-buildings.ics");
    expect(icsFileName("···")).toBe("appointment.ics");
  });
});

describe("misc", () => {
  it("channel from kind, suggested title", () => {
    expect(channelForKind("roof_walk")).toBe("roof_walk");
    expect(channelForKind("call")).toBe("call");
    expect(channelForKind("nope")).toBe("meeting");
    expect(suggestTitle("inspection", "Greystar", 3)).toBe("Inspection · Greystar (3 buildings)");
    expect(suggestTitle("meeting", null, 0)).toBe("Meeting");
  });
  it("route: appointment stops first in their order, then the list nearest-first from the last appointment", () => {
    const s = (id: string, lat: number | null) => ({ id, label: id, address: id, lat, lng: lat == null ? null : -97.7 });
    const order = routeWithFixedFirst([s("A2", 30.3), s("A1", 30.0)], [s("far", 30.5), s("near", 30.05), s("nopin", null)], { lat: 31, lng: -97.7 });
    expect(order.map((x) => x.id)).toEqual(["A2", "A1", "near", "far", "nopin"]);
  });
});
