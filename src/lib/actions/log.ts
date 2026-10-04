"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { log } from "@/lib/observability/log";
import { requestInfo } from "@/lib/observability/request";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { keysEnum, optUuid, cleanQuery, splitName } from "@/lib/server/zod-helpers";
import { CHANNELS, OUTCOMES, PERSONA_ROLES } from "@/lib/domain/vocab";
import { mergePointRules } from "@/lib/domain/points";
import { localDate, logToast } from "@/lib/format";
import { pathInTenants, parseMediaPath } from "@/lib/storage/paths";
import { storageFor } from "@/lib/storage";
import { writeAppointment } from "@/lib/server/appointments-write";
import { APPT_KINDS, channelForKind, clockLabel, dayLabel, isApptKind } from "@/lib/domain/appointments";
import type {
  ContactOption,
  LogContextData,
  LogInput,
  LogResult,
  LogTarget,
  QuickContactInput,
  QuickContactResult,
  SearchHit,
  SimilarContact,
} from "@/lib/actions/log-types";

const CONTACT_COLS = "id,full_name,title,persona_role,account_id";
type ContactRow = { id: string; full_name: string | null; title: string | null; persona_role: string; account_id: string | null };
const toOption = (c: ContactRow, accountName?: string | null): ContactOption => ({
  id: c.id,
  name: c.full_name ?? "Unnamed contact",
  title: c.title,
  persona_role: c.persona_role,
  account_id: c.account_id,
  account_name: accountName ?? null,
});

/** Everything the Log sheet needs for a context: the account, its people, buildings, open deals, point values. */
export async function loadLogContext(target: LogTarget): Promise<LogContextData> {
  const { sb, s, tenantId, today } = await ctx();
  let accountId = target.accountId ?? null;
  let contact: ContactOption | null = null;
  let appointment: LogContextData["appointment"] = null;

  if (target.appointmentId) {
    const [{ data: a }, { count }] = await Promise.all([
      sb.from("appointment").select("id,title,kind,status,account_id").eq("tenant_id", tenantId).eq("id", target.appointmentId).maybeSingle(),
      sb.from("appointment_property").select("property_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("appointment_id", target.appointmentId),
    ]);
    if (a) {
      appointment = { id: a.id, title: a.title, kind: a.kind, channel: channelForKind(a.kind), buildings: count ?? 0, status: a.status };
      accountId = accountId ?? a.account_id;
    }
  }

  if (target.contactId) {
    const { data } = await sb.from("contact").select(CONTACT_COLS).eq("tenant_id", tenantId).eq("id", target.contactId).maybeSingle();
    if (data) {
      contact = toOption(data);
      accountId = accountId ?? data.account_id;
    }
  }
  if (!accountId && target.propertyId) {
    const { data } = await sb.from("property").select("account_id").eq("tenant_id", tenantId).eq("id", target.propertyId).maybeSingle();
    accountId = data?.account_id ?? null;
  }
  if (!accountId && target.opportunityId) {
    const { data } = await sb.from("opportunity").select("account_id").eq("tenant_id", tenantId).eq("id", target.opportunityId).maybeSingle();
    accountId = data?.account_id ?? null;
  }

  const [acct, contacts, props, opps, rules] = await Promise.all([
    accountId ? sb.from("account").select("id,name").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle() : Promise.resolve({ data: null }),
    accountId
      ? sb.from("contact").select(CONTACT_COLS).eq("tenant_id", tenantId).eq("account_id", accountId).is("duplicate_of", null).order("last_touch_at", { ascending: false, nullsFirst: false }).limit(50)
      : Promise.resolve({ data: [] as ContactRow[] }),
    accountId
      ? sb.from("property").select("id,name,address1,city").eq("tenant_id", tenantId).eq("account_id", accountId).is("duplicate_of", null).limit(50)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address1: string | null; city: string | null }[] }),
    accountId
      ? sb.from("opportunity").select("id,name").eq("tenant_id", tenantId).eq("account_id", accountId).not("stage", "in", "(won,lost)").limit(20)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    sb.from("point_rule").select("tenant_id,event,points").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
  ]);

  // No context (the floating Log button on Today, Pipeline…): offer the people I touched most recently so the
  // usual "log the call I just made" is one tap instead of typing a name.
  const recent = !accountId && !contact ? await recentPeople(sb, tenantId, s.userId) : [];

  return {
    account: acct.data ? { id: acct.data.id, name: acct.data.name } : null,
    contact,
    contacts: accountId ? (contacts.data ?? []).map((c) => toOption(c, acct.data?.name)) : recent,
    properties: (props.data ?? []).map((p) => ({ id: p.id, label: p.name || [p.address1, p.city].filter(Boolean).join(", ") || "Unnamed property" })),
    opportunities: (opps.data ?? []).map((o) => ({ id: o.id, name: o.name })),
    points: mergePointRules(rules.data ?? []),
    today,
    appointment,
  };
}

async function recentPeople(sb: Awaited<ReturnType<typeof ctx>>["sb"], tenantId: string, userId: string): Promise<ContactOption[]> {
  const { data: touches } = await sb
    .from("touch")
    .select("contact_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .not("contact_id", "is", null)
    .is("voided_at", null)
    .order("occurred_at", { ascending: false })
    .limit(40);
  const ids = [...new Set((touches ?? []).map((t) => t.contact_id).filter((x): x is string => !!x))].slice(0, 6);
  if (!ids.length) return [];
  const { data: people } = await sb.from("contact").select(CONTACT_COLS).eq("tenant_id", tenantId).in("id", ids).is("duplicate_of", null);
  const acctIds = [...new Set((people ?? []).map((p) => p.account_id).filter((x): x is string => !!x))];
  const { data: accts } = acctIds.length ? await sb.from("account").select("id,name").in("id", acctIds) : { data: [] as { id: string; name: string }[] };
  const names = new Map((accts ?? []).map((a) => [a.id, a.name]));
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [toOption(p, p.account_id ? names.get(p.account_id) : null)] : [];
  });
}

/** Contacts and accounts by name (trigram-indexed columns) for the Log sheet picker. */
export async function searchLogTargets(q: string): Promise<SearchHit[]> {
  const term = cleanQuery(q);
  if (term.length < 2) return [];
  const { sb, tenantId } = await ctx();
  const [contacts, accounts] = await Promise.all([
    sb
      .from("contact")
      .select("id,full_name,title,account_id,email")
      .eq("tenant_id", tenantId)
      .is("duplicate_of", null)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
      .limit(8),
    sb.from("account").select("id,name,city").eq("tenant_id", tenantId).is("duplicate_of", null).ilike("normalized_name", `%${term.toLowerCase()}%`).limit(6),
  ]);
  const acctIds = [...new Set((contacts.data ?? []).map((c) => c.account_id).filter((x): x is string => !!x))];
  const { data: acctNames } = acctIds.length ? await sb.from("account").select("id,name").in("id", acctIds) : { data: [] };
  const names = new Map((acctNames ?? []).map((a) => [a.id, a.name]));
  return [
    ...(contacts.data ?? []).map<SearchHit>((c) => ({
      kind: "contact",
      id: c.id,
      name: c.full_name ?? c.email ?? "Unnamed contact",
      sub: [c.title, c.account_id ? names.get(c.account_id) : null].filter(Boolean).join(" · ") || null,
      accountId: c.account_id,
    })),
    ...(accounts.data ?? []).map<SearchHit>((a) => ({ kind: "account", id: a.id, name: a.name, sub: a.city, accountId: a.id })),
  ];
}

const mediaSchema = z.object({
  kind: z.literal("photo"),
  id: z.string().uuid(),
  path: z.string().max(200),
  width: z.number().int().min(1).max(20000).nullish(),
  height: z.number().int().min(1).max(20000).nullish(),
  taken_at: z.iso.datetime({ offset: true }).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  caption: z.string().trim().max(300).nullish(),
});

/** Offline logs can sit on a phone for days; past this they're more confusing than useful. */
const MAX_BACKDATE_MS = 30 * 86_400_000;

/** No code + a fetch-ish message, a timeout or a connection-class SQLSTATE: the server couldn't reach the DB. */
function isTransient(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code && (e.code.startsWith("08") || e.code === "57014" || e.code === "57P01" || e.code === "53300")) return true;
  return !e.code && /AbortError|FetchError|TypeError|fetch failed|timeout|ECONN|network/i.test(e.message ?? "");
}

const logSchema = z
  .object({
    accountId: optUuid,
    contactId: optUuid,
    propertyId: optUuid,
    opportunityId: optUuid,
    channel: keysEnum(CHANNELS),
    outcome: keysEnum(OUTCOMES),
    notes: z.string().trim().max(4000).optional().nullable(),
    metRole: keysEnum(PERSONA_ROLES).optional().nullable(),
    followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    followUpNote: z.string().trim().max(200).optional().nullable(),
    skipFollowUp: z.boolean().optional(),
    source: z.enum(["rep", "field"]).optional(),
    /** Client-generated per log attempt; a retried/double-tapped submit with the same key logs once. */
    idempotencyKey: z.string().uuid().optional().nullable(),
    media: z.array(mediaSchema).max(12).optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional().nullable(),
    tenantId: optUuid,
    appointmentId: optUuid,
    eachBuilding: z.boolean().optional(),
    appointment: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
        durationMinutes: z.number().int().min(5).max(1440).optional().nullable(),
        kind: z.string().refine(isApptKind).optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .refine((v) => v.accountId || v.contactId || v.propertyId || v.appointmentId, { message: "Pick a contact or an account first." });

/**
 * Log a touch. The database does the rest: closes open follow-ups, schedules the next task, awards points.
 * We only read back what happened so the toast can say it.
 */
export async function logTouch(input: LogInput): Promise<LogResult> {
  const started = Date.now();
  try {
    return await logTouchInner(input);
  } catch (err) {
    unstable_rethrow(err); // session redirects are control flow
    log.error("action:logTouch", { ...(await requestInfo()), durationMs: Date.now() - started, err });
    return { ok: false, retryable: true, error: "Couldn't log that. Check your signal and tap again — it won't double-log." };
  }
}

async function logTouchInner(input: LogInput): Promise<LogResult> {
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the log." };
  const v = parsed.data;
  const c = await ctx();
  const { sb, s } = c;
  let { tenantId, today } = c;
  // An offline log replays in the company it was made in, even if the rep switched since.
  if (v.tenantId && v.tenantId !== tenantId) {
    const t = s.tenants.find((x) => x.id === v.tenantId);
    if (!t) return { ok: false, error: "This log was made in a company you're no longer in. Discard it." };
    tenantId = t.id;
    today = localDate(t.timezone);
  }
  let occurredAt: string | null = null;
  if (v.occurredAt) {
    const at = Date.parse(v.occurredAt);
    if (at < Date.now() - MAX_BACKDATE_MS) return { ok: false, error: "This log is more than 30 days old. Discard it and log it again." };
    // Phone clocks drift: anything "in the future" is now.
    if (at < Date.now() - 60_000) occurredAt = new Date(at).toISOString();
  }
  const media = v.media ?? [];
  if (media.length) {
    if (media.some((m) => !pathInTenants(m.path, [tenantId]) || parseMediaPath(m.path)?.id !== m.id.toLowerCase())) {
      return { ok: false, error: "A photo doesn't belong to this company. Remove it and try again." };
    }
    // Photos earn site-walk points: only count ones that actually landed in storage.
    const have = await storageFor(sb).exists(media.map((m) => m.path));
    if (have.size !== new Set(media.map((m) => m.path)).size) {
      return { ok: false, error: "A photo didn't finish uploading. Tap Try again." };
    }
  }
  const source = v.source ?? "rep";
  // Idempotency: touch_external_uq is unique on (tenant_id, source, external_id). A repeat submit with the
  // same key hits 23505 and we return the touch that already landed instead of logging it twice.
  const externalId = v.idempotencyKey ? `idem:${v.idempotencyKey}` : null;

  let { data: touch, error } = v.appointmentId
    ? await logAppointmentOutcome(sb, v, { externalId, source, media, occurredAt })
    : await sb
    .from("touch")
    .insert({
      tenant_id: tenantId,
      user_id: s.userId,
      account_id: v.accountId ?? null,
      contact_id: v.contactId ?? null,
      property_id: v.propertyId ?? null,
      opportunity_id: v.opportunityId ?? null,
      channel: v.channel,
      outcome: v.outcome,
      notes: v.notes || null,
      met_role: v.metRole ?? null,
      follow_up_on: v.followUpOn ?? null,
      follow_up_note: v.followUpNote || null,
      skip_follow_up: v.skipFollowUp ?? false,
      source,
      external_id: externalId,
      media: media.map((m) => ({ ...m, caption: m.caption || null })),
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
    })
    .select("id")
    .single();
  if (error?.code === "23505" && externalId) {
    const existing = await sb.from("touch").select("id").eq("tenant_id", tenantId).eq("source", source).eq("external_id", externalId).maybeSingle();
    if (existing.data) {
      log.info("action:logTouch:duplicate-submit", { ...(await requestInfo()), tenant: tenantId, user: s.userId, touch: existing.data.id });
      touch = existing.data;
      error = null;
    }
  }
  if (error || !touch) {
    log.warn("action:logTouch:failed", { ...(await requestInfo()), tenant: tenantId, user: s.userId, err: error });
    return { ok: false, error: dbMessage(error, "log that"), retryable: isTransient(error) };
  }

  // Booked inspection → "When?": schedule it in the same action (retries reuse the appointment via booked_touch_id).
  let booked: { id: string; label: string } | null = null;
  if (!v.appointmentId && v.outcome === "scheduled_inspection" && v.appointment) {
    const tz = s.tenants.find((t) => t.id === tenantId)?.timezone ?? s.tenant.timezone;
    const kind = v.appointment.kind && isApptKind(v.appointment.kind) ? v.appointment.kind : "inspection";
    const ap = await writeAppointment(
      { sb, s, tenantId, timeZone: tz },
      {
        kind,
        date: v.appointment.date,
        time: v.appointment.time ?? null,
        allDay: !v.appointment.time,
        durationMinutes: v.appointment.durationMinutes ?? APPT_KINDS[kind].minutes,
        propertyIds: v.propertyId ? [v.propertyId] : [],
        contactIds: v.contactId ? [v.contactId] : [],
        accountId: v.accountId ?? null,
        opportunityId: v.opportunityId ?? null,
        notes: v.notes || null,
      },
      { bookedTouchId: touch.id, source: "log" },
    );
    if (ap.ok) booked = { id: ap.id, label: `${dayLabel(v.appointment.date, today)}${v.appointment.time ? ` ${clockLabel(v.appointment.time)}` : ""}` }; else {
      log.warn("action:logTouch:appointment-failed", { ...(await requestInfo()), tenant: tenantId, user: s.userId, error: ap.error });
    }
  }

  // An appointment outcome may be several touches (one per building): read back all of them.
  const touchIds = v.appointmentId
    ? ((await sb.from("touch").select("id").eq("tenant_id", tenantId).eq("appointment_id", v.appointmentId)).data ?? []).map((t) => t.id)
    : [touch.id];
  const [awards, closed, next] = await Promise.all([
    sb.from("point_event").select("event,points").eq("tenant_id", tenantId).in("touch_id", touchIds.length ? touchIds : [touch.id]).eq("voided", false),
    sb.from("task").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("completed_by_touch_id", touch.id),
    sb.from("task").select("title,due_on").eq("tenant_id", tenantId).eq("created_from_touch_id", touch.id).limit(1).maybeSingle(),
  ]);
  const pts = (awards.data ?? []).reduce((n, a) => n + a.points, 0);
  const result = {
    ok: true as const,
    touchId: touch.id,
    points: pts,
    awards: awards.data ?? [],
    closed: closed.count ?? 0,
    next: next.data ? { title: next.data.title, due_on: next.data.due_on } : null,
    toast: "",
  };
  result.toast = logToast({ points: pts, closed: result.closed, next: result.next, today });
  if (booked) result.toast += ` · Inspection set ${booked.label}`;
  if (v.appointmentId && touchIds.length > 1) result.toast += ` · ${touchIds.length} buildings logged`;
  revalidatePath("/app", "layout");
  return { ...result, appointmentId: booked?.id ?? v.appointmentId ?? null };
}

/** The outcome of an appointment: public.log_appointment_outcome does the touches + completion in one transaction. */
async function logAppointmentOutcome(
  sb: Awaited<ReturnType<typeof ctx>>["sb"],
  v: z.infer<typeof logSchema>,
  t: { externalId: string | null; source: string; media: z.infer<typeof mediaSchema>[]; occurredAt: string | null },
): Promise<{ data: { id: string } | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await sb.rpc("log_appointment_outcome", {
    p_appointment: v.appointmentId!,
    p_channel: v.channel,
    p_outcome: v.outcome,
    p_contact: (v.contactId ?? null) as unknown as string,
    p_met_role: (v.metRole ?? null) as unknown as string,
    p_notes: (v.notes || null) as unknown as string,
    p_each_building: !!v.eachBuilding,
    p_external_id: (t.externalId ?? null) as unknown as string,
    p_media: t.media.map((m) => ({ ...m, caption: m.caption || null })),
    p_occurred_at: (t.occurredAt ?? null) as unknown as string,
    p_follow_up_on: (v.followUpOn ?? null) as unknown as string,
    p_follow_up_note: (v.followUpNote || null) as unknown as string,
    p_skip_follow_up: v.skipFollowUp ?? false,
    p_source: t.source,
    p_opportunity: (v.opportunityId ?? null) as unknown as string,
  });
  if (error) return { data: null, error: error.code === "P0002" ? { code: "PGRST116", message: error.message } : error };
  return { data: data ? { id: String(data) } : null, error: null };
}

// --- Contacts created from the Log sheet / Go: duplicate check first ------------------------------------

const quickSchema = z.object({
  accountId: optUuid,
  propertyId: optUuid,
  fullName: z.string().trim().min(2, "Enter a name").max(120),
  title: z.string().trim().max(120).optional().nullable(),
  personaRole: keysEnum(PERSONA_ROLES).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.string().trim().email("Email looks wrong"), z.literal("")]).optional().nullable(),
  source: z.enum(["rep", "field"]).optional(),
  force: z.boolean().optional(),
  mobile: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  sourceImagePath: z.string().max(200).optional().nullable(),
});

export async function findSimilarContacts(name: string, email?: string | null, phone?: string | null): Promise<SimilarContact[]> {
  const { sb, tenantId } = await ctx();
  // Generated Args type marks p_email/p_phone as string, but the SQL treats null as "not provided"
  // (passing "" would match every contact with no phone). Narrow cast to send null.
  const { data } = await sb.rpc("find_similar_contacts", {
    p_tenant: tenantId,
    p_name: name,
    p_email: (email || null) as unknown as string,
    p_phone: (phone || null) as unknown as string,
  });
  return (data ?? [])
    .filter((d): d is typeof d & { id: string } => !!d.id && (d.similarity ?? 0) >= 0.45)
    .map((d) => ({ id: d.id, full_name: d.full_name, email: d.email, phone: d.phone, account_name: d.account_name, similarity: d.similarity }));
}

export async function quickCreateContact(input: QuickContactInput): Promise<QuickContactResult> {
  const parsed = quickSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the contact." };
  const v = parsed.data;
  if (!v.force) {
    const dupes = await findSimilarContacts(v.fullName, v.email, v.phone);
    if (dupes.length) return { ok: false, duplicates: dupes };
  }
  const { sb, s, tenantId } = await ctx();
  const card = v.sourceImagePath && pathInTenants(v.sourceImagePath, [tenantId]) ? v.sourceImagePath : null;
  const { data, error } = await sb
    .from("contact")
    .insert({
      tenant_id: tenantId,
      account_id: v.accountId ?? null,
      ...splitName(v.fullName),
      title: v.title || null,
      persona_role: v.personaRole ?? "unknown",
      phone: v.phone || null,
      email: v.email || null,
      mobile: v.mobile || null,
      notes: v.notes || null,
      source_image_path: card,
      source: v.source ?? "rep",
      created_by: s.userId,
    })
    .select(CONTACT_COLS)
    .single();
  if (error || !data) return { ok: false, error: dbMessage(error, "add that contact") };
  if (v.propertyId) {
    await sb.from("property_contact").insert({ tenant_id: tenantId, property_id: v.propertyId, contact_id: data.id });
  }
  revalidatePath("/app", "layout");
  return { ok: true, contact: toOption(data) };
}

/** Load one contact as a picker option (used when the rep says "Is this them? — yes"). */
export async function getContactOption(id: string): Promise<ContactOption | null> {
  const { sb, tenantId } = await ctx();
  const { data } = await sb.from("contact").select(CONTACT_COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return data ? toOption(data) : null;
}
