"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { keysEnum, optUuid, cleanQuery, splitName } from "@/lib/server/zod-helpers";
import { CHANNELS, OUTCOMES, PERSONA_ROLES } from "@/lib/domain/vocab";
import { mergePointRules } from "@/lib/domain/points";
import { logToast } from "@/lib/format";
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
  const { sb, tenantId, today } = await ctx();
  let accountId = target.accountId ?? null;
  let contact: ContactOption | null = null;

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

  return {
    account: acct.data ? { id: acct.data.id, name: acct.data.name } : null,
    contact,
    contacts: (contacts.data ?? []).map((c) => toOption(c, acct.data?.name)),
    properties: (props.data ?? []).map((p) => ({ id: p.id, label: p.name || [p.address1, p.city].filter(Boolean).join(", ") || "Unnamed property" })),
    opportunities: (opps.data ?? []).map((o) => ({ id: o.id, name: o.name })),
    points: mergePointRules(rules.data ?? []),
    today,
  };
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
  })
  .refine((v) => v.accountId || v.contactId || v.propertyId, { message: "Pick a contact or an account first." });

/**
 * Log a touch. The database does the rest: closes open follow-ups, schedules the next task, awards points.
 * We only read back what happened so the toast can say it.
 */
export async function logTouch(input: LogInput): Promise<LogResult> {
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the log." };
  const v = parsed.data;
  const { sb, s, tenantId, today } = await ctx();

  const { data: touch, error } = await sb
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
      source: v.source ?? "rep",
    })
    .select("id")
    .single();
  if (error || !touch) return { ok: false, error: dbMessage(error, "log that") };

  const [awards, closed, next] = await Promise.all([
    sb.from("point_event").select("event,points").eq("tenant_id", tenantId).eq("touch_id", touch.id),
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
  revalidatePath("/app", "layout");
  return result;
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
