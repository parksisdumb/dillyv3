import "server-only";
import { z } from "zod";
import type { Ctx } from "@/lib/server/ctx";
import { dbMessage } from "@/lib/server/ctx";
import { APPT_KINDS, isApptKind, suggestTitle, zonedToUtc, type ApptKind } from "@/lib/domain/appointments";
import type { ScheduleInput, ScheduleResult } from "@/lib/appointments/types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");

export const scheduleSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  kind: z.string().refine(isApptKind, "Pick what kind of appointment"),
  title: z.string().trim().max(200).optional().nullable(),
  date: day,
  time: hhmm.optional().nullable(),
  allDay: z.boolean().optional(),
  durationMinutes: z.number().int().min(5).max(24 * 60).optional().nullable(),
  propertyIds: z.array(z.string().uuid()).max(40, "40 buildings max per appointment"),
  contactIds: z.array(z.string().uuid()).max(40),
  accountId: z.string().uuid().optional().nullable(),
  opportunityId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
  reminderMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  location: z.string().trim().max(300).optional().nullable(),
});

type WriteCtx = Pick<Ctx, "sb" | "s"> & { tenantId: string; timeZone: string };

/**
 * Create or update an appointment and its buildings/attendees. Used by the Schedule sheet and by the Log sheet's
 * "Booked inspection → When?" (with `bookedTouchId`, so the booking isn't awarded twice).
 */
export async function writeAppointment(c: WriteCtx, input: ScheduleInput, opts: { bookedTouchId?: string | null; source?: "rep" | "log" } = {}): Promise<ScheduleResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the appointment." };
  const v = parsed.data;
  const { sb, s, tenantId } = c;
  const kind = v.kind as ApptKind;
  const propertyIds = [...new Set(v.propertyIds)];
  const contactIds = [...new Set(v.contactIds)];

  const assigned = v.assignedUserId ?? s.userId;
  if (assigned !== s.userId && !s.isManager) return { ok: false, error: "Only managers can schedule for someone else." };

  // Buildings + account (the account defaults from the first building, then from the first person).
  const { data: props } = propertyIds.length
    ? await sb.from("property").select("id,name,address1,city,state,account_id").eq("tenant_id", tenantId).in("id", propertyIds)
    : { data: [] as { id: string; name: string | null; address1: string | null; city: string | null; state: string | null; account_id: string | null }[] };
  if ((props ?? []).length !== propertyIds.length) return { ok: false, error: "A building isn't in this company. Refresh and try again." };
  const byId = new Map((props ?? []).map((p) => [p.id, p]));
  const first = propertyIds.length ? byId.get(propertyIds[0]) : undefined;
  let accountId = v.accountId ?? first?.account_id ?? null;
  if (!accountId && contactIds.length) {
    const { data: ct } = await sb.from("contact").select("account_id").eq("tenant_id", tenantId).eq("id", contactIds[0]).maybeSingle();
    accountId = ct?.account_id ?? null;
  }
  let place: string | null = null;
  if (accountId) {
    const { data: a } = await sb.from("account").select("name").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle();
    place = a?.name ?? null;
  }
  place = place ?? (first ? first.name || first.address1 : null) ?? null;

  const allDay = !!v.allDay;
  let startsAt: Date;
  try {
    startsAt = zonedToUtc(v.date, allDay ? "00:00" : v.time ?? "09:00", c.timeZone);
  } catch {
    return { ok: false, error: "Pick a date and time." };
  }
  const minutes = allDay ? null : v.durationMinutes ?? APPT_KINDS[kind].minutes;
  const endsAt = minutes ? new Date(startsAt.getTime() + minutes * 60000) : null;
  const location = v.location || (first ? [first.address1, first.city, first.state].filter(Boolean).join(", ") || null : null);
  const title = v.title || suggestTitle(kind, place, propertyIds.length);

  const row = {
    kind,
    title,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() ?? null,
    all_day: allDay,
    location,
    notes: v.notes || null,
    account_id: accountId,
    opportunity_id: v.opportunityId ?? null,
    assigned_user_id: assigned,
    reminder_minutes: v.reminderMinutes ?? 60,
  };

  let id: string;
  if (v.id) {
    const { data: cur, error: readErr } = await sb.from("appointment").select("id,status").eq("tenant_id", tenantId).eq("id", v.id).maybeSingle();
    if (readErr) return { ok: false, error: dbMessage(readErr, "load that appointment") };
    if (!cur) return { ok: false, error: "That appointment is gone — it may have been removed." };
    if (cur.status === "done") return { ok: false, error: "This one already has an outcome logged." };
    const { error } = await sb
      .from("appointment")
      .update({ ...row, ...(cur.status !== "scheduled" ? { status: "scheduled" } : {}) })
      .eq("tenant_id", tenantId)
      .eq("id", v.id);
    if (error) return { ok: false, error: dbMessage(error, "save that appointment") };
    id = v.id;
    // Replace buildings + attendees (small sets; order matters for buildings).
    const [dp, dc] = await Promise.all([
      sb.from("appointment_property").delete().eq("tenant_id", tenantId).eq("appointment_id", id),
      sb.from("appointment_contact").delete().eq("tenant_id", tenantId).eq("appointment_id", id),
    ]);
    if (dp.error || dc.error) return { ok: false, error: dbMessage(dp.error ?? dc.error, "update the buildings") };
  } else {
    const { data, error } = await sb
      .from("appointment")
      .insert({ ...row, tenant_id: tenantId, created_by: s.userId, source: opts.source ?? "rep", booked_touch_id: opts.bookedTouchId ?? null })
      .select("id")
      .single();
    if (error?.code === "23505" && opts.bookedTouchId) {
      // Retried "Booked inspection" log: the appointment already exists for that touch.
      const { data: existing } = await sb.from("appointment").select("id").eq("tenant_id", tenantId).eq("booked_touch_id", opts.bookedTouchId).maybeSingle();
      if (existing) return { ok: true, id: existing.id, message: "Appointment saved", points: 0 };
    }
    if (error || !data) return { ok: false, error: dbMessage(error, "save that appointment") };
    id = data.id;
  }

  if (propertyIds.length) {
    const { error } = await sb
      .from("appointment_property")
      .insert(propertyIds.map((p, i) => ({ tenant_id: tenantId, appointment_id: id, property_id: p, sort: i })));
    if (error) return { ok: false, error: dbMessage(error, "add the buildings") };
  }
  if (contactIds.length) {
    const { error } = await sb.from("appointment_contact").insert(contactIds.map((ct) => ({ tenant_id: tenantId, appointment_id: id, contact_id: ct })));
    if (error) return { ok: false, error: dbMessage(error, "add who's attending") };
  }

  const { data: pts } = await sb.from("point_event").select("points").eq("tenant_id", tenantId).eq("appointment_id", id).eq("voided", false);
  const points = (pts ?? []).reduce((n, p) => n + p.points, 0);
  return { ok: true, id, points, message: v.id ? "Appointment updated" : "Appointment set" };
}
