// Fixtures for the appointment preview screens (schedule-sheet, today-appointments, my-day, appointment-detail).
import type { ApptCard, ApptDetail, ScheduleContext } from "@/lib/appointments/types";
import { stopKey, type DayStop, type Stop } from "@/components/go/types";
import { addDaysLocal, clockLabel, dayLabel, googleCalendarUrl, zonedToUtc } from "@/lib/domain/appointments";
import { mapsUrl } from "@/lib/format";

const TZ = "America/Chicago";
const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

export function appointmentFixtures(today: string, austinStops: Stop[]) {
  const card = (n: number, o: { date: string; time: string; title: string; kind: ApptCard["kind"]; stops: number; account: string; mine?: boolean; minutes?: number }): ApptCard => {
    const start = zonedToUtc(o.date, o.time, TZ);
    const stops = Array.from({ length: o.stops }, (_, i) => {
      const addr = `${1801 + i * 20} S Pleasant Valley Rd, Austin, TX`;
      return { propertyId: id(100 + n * 10 + i), accountId: id(50 + n), name: `Riverside Bldg ${String.fromCharCode(65 + i)}`, address: addr, lat: 30.23 + i * 0.002, lng: -97.71, directions: mapsUrl([addr]) };
    });
    const location = stops[0]?.address ?? "Greystar office, 600 Congress Ave, Austin, TX";
    return {
      id: id(n),
      kind: o.kind,
      kindLabel: { inspection: "Inspection", roof_walk: "Roof walk", meeting: "Meeting", lunch_and_learn: "Lunch & learn", site_visit: "Site visit", call: "Call", other: "Other" }[o.kind],
      title: o.title,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + (o.minutes ?? 60) * 60000).toISOString(),
      allDay: false,
      date: o.date,
      time: o.time,
      dayLabel: dayLabel(o.date, today),
      timeLabel: clockLabel(o.time),
      location,
      directions: mapsUrl([location]),
      notes: o.kind === "inspection" ? "Gate code 4411. Dana meets us at the leasing office; ladder access on Bldg C." : null,
      status: "scheduled",
      accountId: id(50 + n),
      accountName: o.account,
      opportunityId: null,
      assignedUserId: o.mine === false ? id(9) : "00000000-0000-4000-8000-000000000001",
      assignedName: o.mine === false ? "Kayla Smiley" : "Colby Remedios",
      mine: o.mine !== false,
      stops,
      contactCount: 2,
      reminderMinutes: 60,
      needsOutcome: o.date < today,
      past: o.date < today,
    };
  };
  const todayCards = [
    card(1, { date: today, time: "09:00", title: "Inspection · Greystar Riverside (3 buildings)", kind: "inspection", stops: 3, account: "Greystar Riverside", minutes: 120 }),
    card(2, { date: today, time: "13:30", title: "Lunch & learn · CBRE Austin", kind: "lunch_and_learn", stops: 0, account: "CBRE Austin" }),
  ];
  const upcoming = [
    card(3, { date: addDaysLocal(today, 1), time: "10:00", title: "Roof walk · Lincoln Property Co", kind: "roof_walk", stops: 1, account: "Lincoln Property Co" }),
    card(4, { date: addDaysLocal(today, 3), time: "08:30", title: "Meeting · RPM Living", kind: "meeting", stops: 0, account: "RPM Living" }),
  ];
  const appts = { today: todayCards, upcoming, overdue: [] as ApptCard[] };

  const detail: ApptDetail = {
    ...todayCards[0],
    contacts: [
      { id: id(201), name: "Dana Whitfield", title: "Property manager", phone: "(512) 555-0142", email: "dana@greystar.example", accountId: todayCards[0].accountId },
      { id: id(202), name: "Luis Ortega", title: "Maintenance supervisor", phone: "(512) 555-0199", email: null, accountId: todayCards[0].accountId },
    ],
    contactIds: [id(201), id(202)],
    changes: [{ field: "starts_at", oldValue: zonedToUtc(addDaysLocal(today, -1), "14:00", TZ).toISOString(), newValue: todayCards[0].startsAt, at: new Date().toISOString() }],
    outcome: null,
    rescheduleCount: 1,
    cancelReason: null,
    updatedAt: new Date().toISOString(),
    timeZone: TZ,
  };
  const google = googleCalendarUrl({ id: detail.id, title: detail.title, startsAt: detail.startsAt, endsAt: detail.endsAt, allDay: false, location: detail.location, description: detail.notes, timeZone: TZ });

  const schedule: ScheduleContext = {
    account: { id: id(51), name: "Greystar Riverside" },
    properties: ["A", "B", "C", "D"].map((l, i) => ({ id: id(300 + i), label: `Riverside Bldg ${l}`, sub: `${1801 + i * 20} S Pleasant Valley Rd, Austin`, accountId: id(51) })),
    contacts: [
      { id: id(201), name: "Dana Whitfield", title: "Property manager", propertyIds: [id(300)] },
      { id: id(202), name: "Luis Ortega", title: "Maintenance supervisor", propertyIds: [] },
      { id: id(203), name: "Priya Shah", title: "Regional manager", propertyIds: [] },
    ],
    preselectedPropertyIds: [id(300), id(301), id(302)],
    preselectedContactIds: [id(201)],
    members: null,
    meId: "00000000-0000-4000-8000-000000000001",
    timeZone: TZ,
    today,
    defaultDate: addDaysLocal(today, 1),
    defaultTime: "09:00",
  };

  const stops: DayStop[] = austinStops.slice(0, 5).map((s, i) => ({
    ...s,
    key: stopKey(s),
    logged: i === 1 ? "Met in person" : null,
    contacts: s.contacts,
  }));
  return { appts, detail, google, schedule, stops };
}
