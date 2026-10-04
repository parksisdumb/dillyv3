/**
 * Service-role access to the e2e stack for fixtures and assertions. Mutating tests create their OWN rows (unique
 * names) so specs can run in parallel, in both projects, and re-run without depending on each other.
 */
import { adminClient, chicagoToday, dayOffset, PERSONAS, type PersonaKey } from "../../../scripts/e2e/seed";

export { chicagoToday, dayOffset };
export const db = adminClient();

type Tenant = "fox" | "tsg";
const cache = new Map<string, string>();

export async function tenantId(slug: Tenant): Promise<string> {
  const k = `t:${slug}`;
  if (!cache.has(k)) {
    const { data, error } = await db.from("tenant").select("id").eq("slug", slug).single();
    if (error || !data) throw new Error(`tenant ${slug}: ${error?.message}`);
    cache.set(k, data.id);
  }
  return cache.get(k)!;
}

export async function userId(p: PersonaKey): Promise<string> {
  const k = `u:${p}`;
  if (!cache.has(k)) {
    const { data, error } = await db.from("profile").select("id").eq("email", PERSONAS[p].email).single();
    if (error || !data) throw new Error(`user ${p}: ${error?.message}`);
    cache.set(k, data.id);
  }
  return cache.get(k)!;
}

const SYL = ["ka", "lo", "mir", "ven", "dra", "sol", "tez", "quin", "bar", "nok", "pell", "rus", "vat", "zim", "ober", "lax", "fen", "gor"];
/** A pronounceable, practically-unique word, e.g. "Venquinlo". Letters only (keeps name-similarity checks honest). */
export function uniqueWord(n = 3): string {
  let w = "";
  for (let i = 0; i < n; i++) w += SYL[Math.floor(Math.random() * SYL.length)];
  w += SYL[Date.now() % SYL.length] + SYL[Math.floor(Math.random() * SYL.length)];
  return w[0]!.toUpperCase() + w.slice(1);
}

async function one<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error || data == null) throw new Error(`${what}: ${error?.message ?? "no data"}`);
  return data;
}

export async function fxAccount(o: {
  tenant?: Tenant;
  owner?: PersonaKey | null;
  name?: string;
  tier?: number;
  type?: string;
  city?: string;
  phone?: string;
  touchedDaysAgo?: number;
}) {
  const tenant = await tenantId(o.tenant ?? "fox");
  const name = o.name ?? `${uniqueWord()} Properties`;
  const owner = o.owner === null ? null : await userId(o.owner ?? "colby");
  const row = await one(
    db
      .from("account")
      .insert({
        tenant_id: tenant,
        name,
        account_type: o.type ?? "property_mgmt",
        icp_tier: o.tier ?? 2,
        city: o.city ?? "Pflugerville", // keeps fixtures out of the seeded Austin/Dallas field routes
        state: "TX",
        address1: `${100 + Math.floor(Math.random() * 9000)} Lamar Blvd`,
        phone: o.phone ?? null,
        owner_user_id: owner,
        source: "rep",
        is_test: false,
        last_touch_at: o.touchedDaysAgo == null ? null : new Date(Date.now() - o.touchedDaysAgo * 86_400_000).toISOString(),
      })
      .select("id,name")
      .single(),
    "fxAccount",
  );
  return row as unknown as { id: string; name: string };
}

export async function fxContact(o: {
  tenant?: Tenant;
  accountId: string | null;
  first?: string;
  last?: string;
  persona?: string;
  title?: string;
  phone?: string | null;
  email?: string | null;
}) {
  const tenant = await tenantId(o.tenant ?? "fox");
  const first = o.first ?? uniqueWord(2);
  const last = o.last ?? uniqueWord(2);
  const row = await one(
    db
      .from("contact")
      .insert({
        tenant_id: tenant,
        account_id: o.accountId,
        first_name: first,
        last_name: last,
        title: o.title ?? "Property Manager",
        persona_role: o.persona ?? "economic_buyer",
        phone: o.phone ?? null, // no phone by default: keeps fixtures out of Go → Calls
        email: o.email === undefined ? `${first}.${last}@example.com`.toLowerCase() : o.email,
        source: "rep",
      })
      .select("id,full_name")
      .single(),
    "fxContact",
  );
  return row as unknown as { id: string; full_name: string };
}

export async function fxTask(o: {
  tenant?: Tenant;
  assignee?: PersonaKey;
  accountId: string | null;
  contactId?: string | null;
  title?: string;
  kind?: string;
  /** due date relative to tenant-local today (negative = overdue) */
  due?: number;
  createdDaysAgo?: number;
}) {
  const tenant = await tenantId(o.tenant ?? "fox");
  const who = await userId(o.assignee ?? "colby");
  const row = await one(
    db
      .from("task")
      .insert({
        tenant_id: tenant,
        assignee_user_id: who,
        account_id: o.accountId,
        contact_id: o.contactId ?? null,
        kind: o.kind ?? "follow_up",
        title: o.title ?? `Follow up ${uniqueWord()}`,
        reason: "E2E fixture",
        due_on: dayOffset(o.due ?? 0),
        priority: 95,
        source: "rep",
        created_by: who,
        created_at: new Date(Date.now() - (o.createdDaysAgo ?? 2) * 86_400_000).toISOString(),
      })
      .select("id,title")
      .single(),
    "fxTask",
  );
  return row as unknown as { id: string; title: string };
}

export async function fxApproval(o: { tenant?: Tenant; gate: string; summary?: string; actionType?: string }) {
  const tenant = await tenantId(o.tenant ?? "fox");
  const summary = o.summary ?? `${o.gate} ${uniqueWord()} approval`;
  return one(
    db
      .from("approval")
      .insert({
        tenant_id: tenant,
        gate: o.gate,
        action_type: o.actionType ?? (o.gate === "G6" ? "spend_request" : "send_email"),
        summary,
        payload: o.gate === "G6" ? { vendor: "Roofing supply", amount_usd: 1850, memo: summary } : { to: "dana@example.com", subject: summary, body: "Hi Dana —" },
        status: "pending",
      })
      .select("id,summary,status")
      .single(),
    "fxApproval",
  ) as unknown as Promise<{ id: string; summary: string; status: string }>;
}

export async function fxOpportunity(o: { accountId: string; owner?: PersonaKey; name?: string; stage?: string; value?: number; stageDaysAgo?: number }) {
  const tenant = await tenantId("fox");
  const who = await userId(o.owner ?? "colby");
  return one(
    db
      .from("opportunity")
      .insert({
        tenant_id: tenant,
        account_id: o.accountId,
        name: o.name ?? `${uniqueWord()} roof repair`,
        stage: o.stage ?? "inspection_complete",
        value_estimate: o.value ?? 48000,
        next_step: "Send proposal",
        next_step_due: dayOffset(2),
        owner_user_id: who,
        created_by: who,
        stage_changed_at: new Date(Date.now() - (o.stageDaysAgo ?? 1) * 86_400_000).toISOString(),
      })
      .select("id,name")
      .single(),
    "fxOpportunity",
  ) as unknown as Promise<{ id: string; name: string }>;
}

export async function touchesForContact(contactId: string) {
  const { data } = await db.from("touch").select("id,channel,outcome,source,skip_follow_up,follow_up_on,created_at").eq("contact_id", contactId);
  return data ?? [];
}
export async function touchesForAccount(accountId: string) {
  const { data } = await db.from("touch").select("id,channel,outcome,contact_id,source").eq("account_id", accountId);
  return data ?? [];
}
export async function tasksFor(filter: { contactId?: string; accountId?: string }) {
  let q = db.from("task").select("id,title,status,kind,due_on,contact_id,account_id,created_from_touch_id,completed_by_touch_id");
  if (filter.contactId) q = q.eq("contact_id", filter.contactId);
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  const { data } = await q;
  return data ?? [];
}
export async function pointsFor(user: PersonaKey, filter: { accountId?: string; event?: string } = {}) {
  let q = db.from("point_event").select("event,points,account_id").eq("user_id", await userId(user));
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  if (filter.event) q = q.eq("event", filter.event);
  const { data } = await q;
  return data ?? [];
}

/** Poll until fn() returns a truthy value (DB side effects of server actions land a moment after the UI). */
export async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    v = await fn();
  }
  return v;
}
