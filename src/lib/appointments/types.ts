// Shapes shared by appointment server loaders/actions and client components (no server imports).
import type { ApptKind, ApptStatus } from "@/lib/domain/appointments";

export type ApptStop = {
  propertyId: string;
  accountId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  directions: string | null;
};

export type ApptCard = {
  id: string;
  kind: ApptKind;
  kindLabel: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  /** Company-local YYYY-MM-DD / HH:MM. */
  date: string;
  time: string;
  dayLabel: string;
  timeLabel: string;
  location: string | null;
  directions: string | null;
  notes: string | null;
  status: ApptStatus;
  accountId: string | null;
  accountName: string | null;
  opportunityId: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
  mine: boolean;
  stops: ApptStop[];
  contactCount: number;
  reminderMinutes: number;
  /** Still scheduled and its day has passed: log what happened. */
  needsOutcome: boolean;
  past: boolean;
};

export type ApptDetail = ApptCard & {
  contacts: { id: string; name: string; title: string | null; phone: string | null; email: string | null; accountId: string | null }[];
  contactIds: string[];
  changes: { field: string; oldValue: string | null; newValue: string | null; at: string }[];
  outcome: { touchId: string; channel: string; outcome: string; at: string; notes: string | null } | null;
  rescheduleCount: number;
  cancelReason: string | null;
  updatedAt: string;
  timeZone: string;
};

/** Where the Schedule sheet was opened from: pre-selects the building / account / person. */
export type ScheduleTarget = {
  propertyId?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
};

export type ScheduleProperty = { id: string; label: string; sub: string | null; accountId: string | null };
export type ScheduleContact = { id: string; name: string; title: string | null; propertyIds: string[] };

export type ScheduleContext = {
  account: { id: string; name: string } | null;
  /** The account's buildings (multi-select), plus the target building if it has no account. */
  properties: ScheduleProperty[];
  contacts: ScheduleContact[];
  preselectedPropertyIds: string[];
  preselectedContactIds: string[];
  /** Managers can assign someone else. */
  members: { id: string; name: string }[] | null;
  meId: string;
  timeZone: string;
  today: string;
  /** Suggested start in the company's zone. */
  defaultDate: string;
  defaultTime: string;
};

/** Create (no id) or edit/reschedule (id). Date + time are company-local. */
export type ScheduleInput = {
  id?: string | null;
  kind: string;
  title?: string | null;
  date: string;
  time?: string | null;
  allDay?: boolean;
  durationMinutes?: number | null;
  propertyIds: string[];
  contactIds: string[];
  accountId?: string | null;
  opportunityId?: string | null;
  notes?: string | null;
  assignedUserId?: string | null;
  reminderMinutes?: number | null;
  location?: string | null;
};

export type ScheduleResult = { ok: true; id: string; message: string; points: number } | { ok: false; error: string };

/** Booked-inspection follow-through from the Log sheet: "When?" */
export type LogAppointment = { date: string; time?: string | null; durationMinutes?: number | null; kind?: string | null };
