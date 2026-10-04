import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { addDays, dayStartISO, mapsUrl } from "@/lib/format";
import { APPT_KINDS, clockLabel, dayLabel, isApptKind, utcToZoned } from "@/lib/domain/appointments";
import type { ApptCard, ApptDetail, ApptStop } from "@/lib/appointments/types";

const APPT_COLS =
  "id,kind,title,starts_at,ends_at,all_day,location,notes,account_id,opportunity_id,assigned_user_id,created_by,status,outcome_touch_id,reminder_minutes,reschedule_count,cancel_reason,updated_at";
type ApptRow = {
  id: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  assigned_user_id: string | null;
  created_by: string | null;
  status: string;
  outcome_touch_id: string | null;
  reminder_minutes: number;
  reschedule_count: number;
  cancel_reason: string | null;
  updated_at: string;
};

type Lite = Pick<Ctx, "sb" | "tenantId" | "today"> & { s: Pick<Ctx["s"], "userId"> & { tenant: { timezone: string } } };

/** Rows → cards: buildings in order (address + pin), account name, assignee name, labels in the company's zone. */
async function toCards(c: Lite, rows: ApptRow[]): Promise<ApptCard[]> {
  if (!rows.length) return [];
  const { sb, tenantId, today } = c;
  const tz = c.s.tenant.timezone;
  const ids = rows.map((r) => r.id);
  const [linksRes, peopleRes] = await Promise.all([
    sb.from("appointment_property").select("appointment_id,property_id,sort").eq("tenant_id", tenantId).in("appointment_id", ids),
    sb.from("appointment_contact").select("appointment_id,contact_id").eq("tenant_id", tenantId).in("appointment_id", ids),
  ]);
  const links = linksRes.data ?? [];
  const propIds = [...new Set(links.map((l) => l.property_id))];
  const acctIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.assigned_user_id).filter((x): x is string => !!x))];
  const [propsRes, acctRes, userRes] = await Promise.all([
    propIds.length
      ? sb.from("property").select("id,name,address1,city,state,lat,lng,account_id").in("id", propIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address1: string | null; city: string | null; state: string | null; lat: number | null; lng: number | null; account_id: string | null }[] }),
    acctIds.length ? sb.from("account").select("id,name").in("id", acctIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    userIds.length ? sb.from("profile").select("id,full_name,email").in("id", userIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);
  const props = new Map((propsRes.data ?? []).map((p) => [p.id, p]));
  const accts = new Map((acctRes.data ?? []).map((a) => [a.id, a.name]));
  const users = new Map((userRes.data ?? []).map((u) => [u.id, u.full_name || u.email]));
  const contactCount = new Map<string, number>();
  for (const p of peopleRes.data ?? []) contactCount.set(p.appointment_id, (contactCount.get(p.appointment_id) ?? 0) + 1);

  return rows.map((r) => {
    const stops: ApptStop[] = links
      .filter((l) => l.appointment_id === r.id)
      .sort((a, b) => a.sort - b.sort || a.property_id.localeCompare(b.property_id))
      .flatMap((l) => {
        const p = props.get(l.property_id);
        if (!p) return [];
        const address = [p.address1, p.city, p.state].filter(Boolean).join(", ") || null;
        return [
          {
            propertyId: p.id,
            accountId: p.account_id,
            name: p.name || p.address1 || "Building",
            address,
            lat: p.lat == null ? null : Number(p.lat),
            lng: p.lng == null ? null : Number(p.lng),
            directions: mapsUrl([p.address1, p.city, p.state]),
          },
        ];
      });
    const { date, time } = utcToZoned(r.starts_at, tz);
    const location = r.location || stops[0]?.address || null;
    return {
      id: r.id,
      kind: isApptKind(r.kind) ? r.kind : "other",
      kindLabel: isApptKind(r.kind) ? APPT_KINDS[r.kind].label : "Appointment",
      title: r.title,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      allDay: r.all_day,
      date,
      time,
      dayLabel: dayLabel(date, today),
      timeLabel: r.all_day ? "All day" : clockLabel(time),
      location,
      directions: location ? mapsUrl([location]) : null,
      notes: r.notes,
      status: r.status as ApptCard["status"],
      accountId: r.account_id,
      accountName: r.account_id ? accts.get(r.account_id) ?? null : null,
      opportunityId: r.opportunity_id,
      assignedUserId: r.assigned_user_id,
      assignedName: r.assigned_user_id ? users.get(r.assigned_user_id) ?? null : null,
      mine: r.assigned_user_id === c.s.userId,
      stops,
      contactCount: contactCount.get(r.id) ?? 0,
      reminderMinutes: r.reminder_minutes,
      needsOutcome: r.status === "scheduled" && date < today,
      past: date < today,
    };
  });
}

/** My scheduled appointments: today's (in time order) and the next `days` days after today. */
export async function loadMyAppointments(c: Lite, days = 7): Promise<{ today: ApptCard[]; upcoming: ApptCard[]; overdue: ApptCard[] }> {
  const tz = c.s.tenant.timezone;
  const from = dayStartISO(addDays(c.today, -30), tz);
  const to = dayStartISO(addDays(c.today, days + 1), tz);
  const { data, error } = await c.sb
    .from("appointment")
    .select(APPT_COLS)
    .eq("tenant_id", c.tenantId)
    .eq("assigned_user_id", c.s.userId)
    .in("status", ["scheduled"])
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at")
    .limit(100);
  if (error) throw new Error(`appointments: ${error.message}`);
  const cards = await toCards(c, (data ?? []) as ApptRow[]);
  return {
    today: cards.filter((a) => a.date === c.today),
    upcoming: cards.filter((a) => a.date > c.today),
    overdue: cards.filter((a) => a.date < c.today),
  };
}

export type RecordRef = { propertyId?: string | null; accountId?: string | null; contactId?: string | null };

/** Appointments on a record (property / account / contact): upcoming + ones still waiting for an outcome. */
export async function loadRecordAppointments(c: Lite, ref: RecordRef): Promise<ApptCard[]> {
  const { sb, tenantId } = c;
  let ids: string[] | null = null;
  if (ref.propertyId) {
    const { data } = await sb.from("appointment_property").select("appointment_id").eq("tenant_id", tenantId).eq("property_id", ref.propertyId).limit(200);
    ids = (data ?? []).map((d) => d.appointment_id);
  } else if (ref.contactId) {
    const { data } = await sb.from("appointment_contact").select("appointment_id").eq("tenant_id", tenantId).eq("contact_id", ref.contactId).limit(200);
    ids = (data ?? []).map((d) => d.appointment_id);
  }
  if (ids && ids.length === 0) return [];
  const since = dayStartISO(addDays(c.today, -30), c.s.tenant.timezone);
  let q = sb.from("appointment").select(APPT_COLS).eq("tenant_id", tenantId).eq("status", "scheduled").gte("starts_at", since);
  if (ids) q = q.in("id", ids.slice(0, 200));
  else if (ref.accountId) q = q.eq("account_id", ref.accountId);
  else return [];
  const { data, error } = await q.order("starts_at").limit(20);
  if (error) throw new Error(`record appointments: ${error.message}`);
  return toCards(c, (data ?? []) as ApptRow[]);
}

/** One appointment with everything the detail page shows. null = not in this company (→ 404). */
export async function loadAppointment(c: Lite, id: string): Promise<ApptDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { sb, tenantId } = c;
  const { data, error } = await sb.from("appointment").select(APPT_COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(`appointment ${id}: ${error.message}`);
  if (!data) return null;
  const [card] = await toCards(c, [data as ApptRow]);
  const [peopleRes, changesRes, outcomeRes] = await Promise.all([
    sb.from("appointment_contact").select("contact_id").eq("tenant_id", tenantId).eq("appointment_id", id),
    sb.from("appointment_change").select("field,old_value,new_value,changed_at").eq("tenant_id", tenantId).eq("appointment_id", id).order("changed_at", { ascending: false }).limit(20),
    data.outcome_touch_id ? sb.from("touch").select("id,channel,outcome,occurred_at,notes").eq("id", data.outcome_touch_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const contactIds = (peopleRes.data ?? []).map((p) => p.contact_id);
  const { data: people } = contactIds.length
    ? await sb.from("contact").select("id,full_name,title,phone,mobile,email,do_not_contact,account_id").in("id", contactIds)
    : { data: [] as { id: string; full_name: string | null; title: string | null; phone: string | null; mobile: string | null; email: string | null; do_not_contact: boolean; account_id: string | null }[] };
  return {
    ...card,
    contacts: (people ?? []).map((p) => ({
      id: p.id,
      name: p.full_name ?? "Unnamed",
      title: p.title,
      phone: p.do_not_contact ? null : p.mobile ?? p.phone,
      email: p.do_not_contact ? null : p.email,
      accountId: p.account_id,
    })),
    contactIds,
    changes: (changesRes.data ?? []).map((ch) => ({ field: ch.field, oldValue: ch.old_value, newValue: ch.new_value, at: ch.changed_at })),
    outcome: outcomeRes.data ? { touchId: outcomeRes.data.id, channel: outcomeRes.data.channel, outcome: outcomeRes.data.outcome, at: outcomeRes.data.occurred_at, notes: outcomeRes.data.notes } : null,
    rescheduleCount: data.reschedule_count,
    cancelReason: data.cancel_reason,
    updatedAt: data.updated_at,
    timeZone: c.s.tenant.timezone,
  };
}

/** Today: create the "Log outcome" tasks for yesterday's (and older) appointments that never got one. Never throws. */
export async function ensureOutcomeTasks(c: Pick<Ctx, "sb" | "tenantId">): Promise<number> {
  const { data, error } = await c.sb.rpc("appointment_outcome_tasks", { p_tenant: c.tenantId });
  if (error) return 0;
  return Number(data ?? 0);
}
