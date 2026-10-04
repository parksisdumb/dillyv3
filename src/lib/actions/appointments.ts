"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { getMembers } from "@/lib/server/members";
import { writeAppointment } from "@/lib/server/appointments-write";
import { defaultStart } from "@/lib/domain/appointments";
import type { ActionState } from "@/lib/actions/state";
import type { ScheduleContext, ScheduleInput, ScheduleProperty, ScheduleResult, ScheduleTarget } from "@/lib/appointments/types";

const uuid = z.string().uuid();
const propLabel = (p: { name: string | null; address1: string | null; city: string | null }) => p.name || [p.address1, p.city].filter(Boolean).join(", ") || "Unnamed building";
const propSub = (p: { name: string | null; address1: string | null; city: string | null }) => (p.name ? [p.address1, p.city].filter(Boolean).join(", ") || null : p.city);

/** What the Schedule sheet needs for a record: the account's buildings and people, teammates (managers), defaults. */
export async function loadScheduleContext(target: ScheduleTarget, appointmentId?: string | null): Promise<ScheduleContext> {
  const { sb, s, tenantId, today } = await ctx();
  const tz = s.tenant.timezone;
  let accountId = target.accountId ?? null;
  const preProps: string[] = [];
  const preContacts: string[] = [];
  let extraProps: ScheduleProperty[] = [];

  if (appointmentId && uuid.safeParse(appointmentId).success) {
    const [a, ap, ac] = await Promise.all([
      sb.from("appointment").select("account_id").eq("tenant_id", tenantId).eq("id", appointmentId).maybeSingle(),
      sb.from("appointment_property").select("property_id,sort").eq("tenant_id", tenantId).eq("appointment_id", appointmentId).order("sort"),
      sb.from("appointment_contact").select("contact_id").eq("tenant_id", tenantId).eq("appointment_id", appointmentId),
    ]);
    accountId = accountId ?? a.data?.account_id ?? null;
    preProps.push(...(ap.data ?? []).map((x) => x.property_id));
    preContacts.push(...(ac.data ?? []).map((x) => x.contact_id));
  }
  if (target.propertyId) {
    preProps.push(target.propertyId);
    if (!accountId) {
      const { data } = await sb.from("property").select("account_id").eq("tenant_id", tenantId).eq("id", target.propertyId).maybeSingle();
      accountId = data?.account_id ?? null;
    }
  }
  if (target.contactId) {
    preContacts.push(target.contactId);
    if (!accountId) {
      const { data } = await sb.from("contact").select("account_id").eq("tenant_id", tenantId).eq("id", target.contactId).maybeSingle();
      accountId = data?.account_id ?? null;
    }
    // The person's buildings are the likely stops.
    if (!target.propertyId && !appointmentId) {
      const { data } = await sb.from("property_contact").select("property_id").eq("tenant_id", tenantId).eq("contact_id", target.contactId).limit(5);
      if ((data ?? []).length === 1) preProps.push(data![0].property_id);
    }
  }

  const [acct, props, people, members] = await Promise.all([
    accountId ? sb.from("account").select("id,name").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle() : Promise.resolve({ data: null }),
    accountId
      ? sb.from("property").select("id,name,address1,city,account_id").eq("tenant_id", tenantId).eq("account_id", accountId).is("duplicate_of", null).order("name").limit(200)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address1: string | null; city: string | null; account_id: string | null }[] }),
    accountId
      ? sb.from("contact").select("id,full_name,title").eq("tenant_id", tenantId).eq("account_id", accountId).is("duplicate_of", null).eq("do_not_contact", false).order("last_touch_at", { ascending: false, nullsFirst: false }).limit(60)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; title: string | null }[] }),
    s.isManager ? getMembers({ sb, tenantId }) : Promise.resolve(null),
  ]);
  const list: ScheduleProperty[] = (props.data ?? []).map((p) => ({ id: p.id, label: propLabel(p), sub: propSub(p), accountId: p.account_id }));
  // Pre-selected buildings outside the account (another owner, or none) still show.
  const missing = [...new Set(preProps)].filter((id) => !list.some((p) => p.id === id));
  if (missing.length) {
    const { data } = await sb.from("property").select("id,name,address1,city,account_id").eq("tenant_id", tenantId).in("id", missing);
    extraProps = (data ?? []).map((p) => ({ id: p.id, label: propLabel(p), sub: propSub(p), accountId: p.account_id }));
  }
  let contacts = (people.data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? "Unnamed", title: p.title, propertyIds: [] as string[] }));
  const missingPeople = [...new Set(preContacts)].filter((id) => !contacts.some((p) => p.id === id));
  if (missingPeople.length) {
    const { data } = await sb.from("contact").select("id,full_name,title").eq("tenant_id", tenantId).in("id", missingPeople);
    contacts = [...(data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? "Unnamed", title: p.title, propertyIds: [] as string[] })), ...contacts];
  }
  // Who's linked to which building (to suggest attendees for the selected stops).
  const allProps = [...extraProps, ...list].map((p) => p.id);
  if (allProps.length && contacts.length) {
    const { data: links } = await sb.from("property_contact").select("property_id,contact_id").eq("tenant_id", tenantId).in("property_id", allProps.slice(0, 200));
    for (const l of links ?? []) contacts.find((x) => x.id === l.contact_id)?.propertyIds.push(l.property_id);
  }
  const start = defaultStart(new Date(), tz);
  return {
    account: acct.data ? { id: acct.data.id, name: acct.data.name } : null,
    properties: [...extraProps, ...list],
    contacts,
    preselectedPropertyIds: [...new Set(preProps)],
    preselectedContactIds: [...new Set(preContacts)],
    members: members ? members.filter((m) => ["rep", "manager", "owner", "admin"].includes(m.role)).map((m) => ({ id: m.user_id, name: m.name })) : null,
    meId: s.userId,
    timeZone: tz,
    today,
    defaultDate: start.date,
    defaultTime: start.time,
  };
}

/** Buildings by name / address for "add another building" (trigram-indexed columns). */
export async function searchScheduleProperties(q: string): Promise<ScheduleProperty[]> {
  const term = cleanQuery(q);
  if (term.length < 2) return [];
  const { sb, tenantId } = await ctx();
  const { data } = await sb
    .from("property")
    .select("id,name,address1,city,account_id")
    .eq("tenant_id", tenantId)
    .is("duplicate_of", null)
    .or(`name.ilike.%${term}%,address1.ilike.%${term}%,city.ilike.%${term}%`)
    .limit(10);
  return (data ?? []).map((p) => ({ id: p.id, label: propLabel(p), sub: propSub(p), accountId: p.account_id }));
}

export async function saveAppointment(input: ScheduleInput): Promise<ScheduleResult> {
  const c = await ctx();
  const r = await writeAppointment({ sb: c.sb, s: c.s, tenantId: c.tenantId, timeZone: c.s.tenant.timezone }, input);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

const statusSchema = z.object({
  id: uuid,
  status: z.enum(["canceled", "no_show", "scheduled"]),
  reason: z.string().trim().max(300).optional().nullable(),
});

/** Cancel, mark no-show, or put a canceled one back on the schedule. Logging the outcome is logTouch (appointmentId). */
export async function setAppointmentStatus(input: { id: string; status: "canceled" | "no_show" | "scheduled"; reason?: string | null }): Promise<ActionState> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown appointment." };
  const { sb, tenantId } = await ctx();
  const { data: cur } = await sb.from("appointment").select("status").eq("tenant_id", tenantId).eq("id", parsed.data.id).maybeSingle();
  if (!cur) return { ok: false, error: "That appointment is gone — it may have been removed." };
  if (cur.status === "done") return { ok: false, error: "This one already has an outcome logged." };
  const { error } = await sb
    .from("appointment")
    .update({ status: parsed.data.status, cancel_reason: parsed.data.status === "canceled" ? parsed.data.reason || null : null })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: dbMessage(error, "update that appointment") };
  revalidatePath("/app", "layout");
  const message = parsed.data.status === "canceled" ? "Appointment canceled" : parsed.data.status === "no_show" ? "Marked no-show" : "Back on the schedule";
  return { ok: true, message };
}
