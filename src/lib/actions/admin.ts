"use server";
// Admin: people (invite, temporary logins, roles, access, passwords), company settings, markets, and the platform
// (companies). Role/access rules: src/lib/domain/admin.ts (+ RLS + the last-owner trigger). Every change is audited.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import { adminCtx } from "@/lib/server/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { accessChangeProblem, assignableRoles, roleChangeProblem, slugify, tempPassword } from "@/lib/domain/admin";
import { ROLES } from "@/lib/domain/vocab";
import { TENANT_COOKIE } from "@/lib/session";
import type { ActionState } from "@/lib/actions/state";
import type { Json } from "@/lib/db/database.types";
import { log } from "@/lib/observability/log";

export type AdminState = ActionState & { tempPassword?: string; email?: string; userId?: string; ownedAccounts?: number; tenantSlug?: string };

type C = Awaited<ReturnType<typeof adminCtx>>;

async function audit(c: C, a: { action: string; tenantId?: string; targetUserId?: string | null; targetEmail?: string | null; before?: unknown; after?: unknown }) {
  const { error } = await c.sb.from("admin_audit").insert({
    tenant_id: a.tenantId ?? c.tenantId,
    actor_user_id: c.s.userId,
    action: a.action,
    target_user_id: a.targetUserId ?? null,
    target_email: a.targetEmail ?? null,
    before: (a.before ?? null) as Json,
    after: (a.after ?? null) as Json,
  });
  if (error) log.error("admin:audit-failed", { action: a.action, err: error });
}

function refresh() {
  revalidatePath("/app", "layout");
}

async function activeOwners(c: C, tenantId = c.tenantId): Promise<number> {
  const { count } = await c.sb.from("membership").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("role", "owner").eq("active", true);
  return count ?? 0;
}

async function memberOf(c: C, userId: string) {
  const { data } = await c.sb.from("membership").select("user_id,role,active").eq("tenant_id", c.tenantId).eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const { data: p } = await c.sb.from("profile").select("email,full_name").eq("id", userId).maybeSingle();
  return { ...data, email: p?.email ?? "", name: p?.full_name ?? p?.email ?? "Teammate" };
}

/**
 * Service-role login with a temporary password (shown once). The person must change it at first sign-in
 * (app_metadata.must_change_password — only the service role can set or clear it). If the email already has a login,
 * nothing about it changes and they keep their password.
 */
async function createLogin(email: string, fullName: string | null): Promise<{ userId: string; temp: string | null } | { error: string }> {
  const admin = supabaseAdmin();
  const temp = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temp,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
    app_metadata: { must_change_password: true },
  });
  if (data?.user) return { userId: data.user.id, temp };
  const exists = error && (error.status === 422 || /already|exists|registered/i.test(error.message));
  if (!exists) return { error: error?.message ?? "Couldn't create the login." };
  const { data: p } = await admin.from("profile").select("id").eq("email", email).maybeSingle();
  if (!p) return { error: "That email has a login but no profile yet — send an invite instead." };
  return { userId: p.id, temp: null };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  full_name: z.string().trim().max(120).optional(),
  role: z.enum(ROLES),
  create_login: z.string().optional(),
});

/** Invite by email (they join at first sign-in), or "Create login now" with a temporary password. */
export async function inviteMember(_: AdminState, fd: FormData): Promise<AdminState> {
  const parsed = inviteSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const c = await adminCtx();
  const v = parsed.data;
  if (!assignableRoles(c.actor).includes(v.role)) return { ok: false, error: "You can't give that role." };
  const { data: existing } = await c.sb.from("membership").select("user_id").eq("tenant_id", c.tenantId).in(
    "user_id",
    ((await c.sb.from("profile").select("id").eq("email", v.email)).data ?? []).map((p) => p.id).concat(["00000000-0000-0000-0000-000000000000"]),
  );
  if (existing?.length) return { ok: false, error: `${v.email} is already on the team.` };

  if (v.create_login === "1") {
    const made = await createLogin(v.email, v.full_name ?? null);
    if ("error" in made) return { ok: false, error: made.error };
    const { error } = await c.sb.from("membership").insert({ tenant_id: c.tenantId, user_id: made.userId, role: v.role });
    if (error) return { ok: false, error: dbMessage(error, "add them to the team") };
    if (v.full_name) await supabaseAdmin().from("profile").update({ full_name: v.full_name }).eq("id", made.userId).is("full_name", null);
    // Any old invite for this email is now moot.
    await c.sb.from("invite").update({ claimed_at: new Date().toISOString() }).eq("tenant_id", c.tenantId).eq("email", v.email).is("claimed_at", null);
    await audit(c, { action: made.temp ? "member.login_created" : "member.added", targetUserId: made.userId, targetEmail: v.email, after: { role: v.role } });
    refresh();
    return made.temp
      ? { ok: true, message: `Login created for ${v.email}`, tempPassword: made.temp, email: v.email, userId: made.userId }
      : { ok: true, message: `${v.email} already had a login — added to ${c.s.tenant.name}. They sign in with their own password.`, email: v.email, userId: made.userId };
  }

  const { error } = await c.sb.from("invite").insert({ tenant_id: c.tenantId, email: v.email, role: v.role, full_name: v.full_name ?? null });
  if (error) return { ok: false, error: error.code === "23505" ? "That email is already invited." : dbMessage(error, "send the invite") };
  await audit(c, { action: "invite.created", targetEmail: v.email, after: { role: v.role } });
  refresh();
  return { ok: true, message: `Invited ${v.email}. They join ${c.s.tenant.name} the first time they sign in with this email.`, email: v.email };
}

export async function changeRole(input: { userId: string; role: string }): Promise<AdminState> {
  const v = z.object({ userId: z.string().uuid(), role: z.enum(ROLES) }).safeParse(input);
  if (!v.success) return { ok: false, error: "Pick a role." };
  const c = await adminCtx();
  const m = await memberOf(c, v.data.userId);
  if (!m) return { ok: false, error: "They're not on this team." };
  const problem = roleChangeProblem(c.actor, { userId: m.user_id, role: m.role, active: m.active }, v.data.role, await activeOwners(c));
  if (problem) return { ok: false, error: problem };
  const { error } = await c.sb.from("membership").update({ role: v.data.role }).eq("tenant_id", c.tenantId).eq("user_id", m.user_id);
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : dbMessage(error, "change the role") };
  await audit(c, { action: "member.role_changed", targetUserId: m.user_id, targetEmail: m.email, before: { role: m.role }, after: { role: v.data.role } });
  refresh();
  return { ok: true, message: `${m.name} is now ${v.data.role}` };
}

/** Deactivate (access gone on their next request; accounts and tasks stay) or reactivate. */
export async function setMemberActive(input: { userId: string; active: boolean }): Promise<AdminState> {
  const v = z.object({ userId: z.string().uuid(), active: z.boolean() }).safeParse(input);
  if (!v.success) return { ok: false, error: "Unknown person." };
  const c = await adminCtx();
  const m = await memberOf(c, v.data.userId);
  if (!m) return { ok: false, error: "They're not on this team." };
  const problem = accessChangeProblem(c.actor, { userId: m.user_id, role: m.role, active: m.active }, v.data.active, await activeOwners(c));
  if (problem) return { ok: false, error: problem };
  const { error } = await c.sb.from("membership").update({ active: v.data.active }).eq("tenant_id", c.tenantId).eq("user_id", m.user_id);
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : dbMessage(error, "change their access") };
  await audit(c, { action: v.data.active ? "member.reactivated" : "member.deactivated", targetUserId: m.user_id, targetEmail: m.email, before: { active: m.active }, after: { active: v.data.active } });
  const { count } = await c.sb.from("account").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId).eq("owner_user_id", m.user_id).is("duplicate_of", null);
  refresh();
  return {
    ok: true,
    userId: m.user_id,
    ownedAccounts: v.data.active ? 0 : count ?? 0,
    message: v.data.active ? `${m.name} has access again` : `${m.name} is deactivated — they can't open ${c.s.tenant.name} anymore`,
  };
}

/** Move every account a person owns to someone else (bulk_update_accounts: tasks follow the owner). */
export async function reassignAllAccounts(input: { fromUserId: string; toUserId: string | null }): Promise<AdminState> {
  const v = z.object({ fromUserId: z.string().uuid(), toUserId: z.string().uuid().nullable() }).safeParse(input);
  if (!v.success) return { ok: false, error: "Pick who gets them." };
  const c = await adminCtx();
  const { data: accts } = await c.sb.from("account").select("id").eq("tenant_id", c.tenantId).eq("owner_user_id", v.data.fromUserId).is("duplicate_of", null).limit(1000);
  const ids = (accts ?? []).map((a) => a.id);
  if (!ids.length) return { ok: true, message: "Nothing to reassign" };
  const { data, error } = await c.sb.rpc("bulk_update_accounts", { p_tenant: c.tenantId, p_accounts: ids, p_changes: { owner_user_id: v.data.toUserId } as Json });
  if (error) return { ok: false, error: dbMessage(error, "reassign their accounts") };
  const r = (data ?? {}) as { accounts?: number; tasks_moved?: number };
  await audit(c, { action: "member.accounts_reassigned", targetUserId: v.data.fromUserId, after: { to: v.data.toUserId, accounts: r.accounts ?? ids.length } });
  refresh();
  return { ok: true, message: `Reassigned ${r.accounts ?? ids.length} accounts${r.tasks_moved ? ` · ${r.tasks_moved} open tasks moved` : ""}` };
}

export async function resetPassword(input: { userId: string }): Promise<AdminState> {
  const v = z.object({ userId: z.string().uuid() }).safeParse(input);
  if (!v.success) return { ok: false, error: "Unknown person." };
  const c = await adminCtx();
  const m = await memberOf(c, v.data.userId);
  if (!m) return { ok: false, error: "They're not on this team." };
  if (m.user_id === c.s.userId) return { ok: false, error: "Change your own password in Settings." };
  if (m.role === "owner" && !(c.actor.isPlatformAdmin || c.actor.role === "owner")) return { ok: false, error: "Only an owner can reset an owner's password." };
  const temp = tempPassword();
  const { error } = await supabaseAdmin().auth.admin.updateUserById(m.user_id, { password: temp, app_metadata: { must_change_password: true } });
  if (error) return { ok: false, error: `Couldn't reset the password: ${error.message}` };
  await audit(c, { action: "member.password_reset", targetUserId: m.user_id, targetEmail: m.email });
  return { ok: true, message: `New temporary password for ${m.email}`, tempPassword: temp, email: m.email, userId: m.user_id };
}

export async function revokeInvite(input: { inviteId: string }): Promise<AdminState> {
  const v = z.object({ inviteId: z.string().uuid() }).safeParse(input);
  if (!v.success) return { ok: false, error: "Unknown invite." };
  const c = await adminCtx();
  const { data, error } = await c.sb.from("invite").delete().eq("tenant_id", c.tenantId).eq("id", v.data.inviteId).is("claimed_at", null).select("email,role");
  if (error) return { ok: false, error: dbMessage(error, "revoke the invite") };
  if (!data?.length) return { ok: false, error: "That invite was already used or revoked." };
  await audit(c, { action: "invite.revoked", targetEmail: String(data[0]!.email), before: { role: data[0]!.role } });
  refresh();
  return { ok: true, message: `Invite for ${data[0]!.email} revoked` };
}

/** Re-send: emails a fresh sign-in link (the invite itself never expires). */
export async function resendInvite(input: { inviteId: string }): Promise<AdminState> {
  const v = z.object({ inviteId: z.string().uuid() }).safeParse(input);
  if (!v.success) return { ok: false, error: "Unknown invite." };
  const c = await adminCtx();
  const { data: inv } = await c.sb.from("invite").select("email").eq("tenant_id", c.tenantId).eq("id", v.data.inviteId).is("claimed_at", null).maybeSingle();
  if (!inv) return { ok: false, error: "That invite was already used or revoked." };
  const email = String(inv.email);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const { error } = await supabaseAdmin().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: origin ? `${origin}/auth/callback?next=/app/today` : undefined } });
  await audit(c, { action: "invite.resent", targetEmail: email, after: error ? { error: error.message } : null });
  if (error) return { ok: false, error: `Couldn't send the email (${error.message}). They can still sign in at the login page with ${email}.` };
  return { ok: true, message: `Sign-in link sent to ${email}` };
}

// --- Company -------------------------------------------------------------------------------------------------

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"] as const;

const companySchema = z.object({
  name: z.string().trim().min(2, "Enter the company name").max(120),
  brand_name: z.string().trim().max(120).optional(),
  timezone: z.enum(TIMEZONES),
});

export async function saveCompany(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = companySchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const c = await adminCtx();
  const { data: before } = await c.sb.from("tenant").select("name,brand_name,timezone").eq("id", c.tenantId).single();
  const after = { name: parsed.data.name, brand_name: parsed.data.brand_name ?? null, timezone: parsed.data.timezone };
  const { error } = await c.sb.from("tenant").update(after).eq("id", c.tenantId);
  if (error) return { ok: false, error: dbMessage(error, "save the company") };
  await audit(c, { action: "company.updated", before, after });
  refresh();
  return { ok: true, message: "Company saved" };
}

const noticeSchema = z.object({
  quiet_from: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  quiet_to: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  weekend_reminders: z.string().optional(),
  max_pushes_per_day: z.coerce.number().int().min(0).max(20),
});

export async function saveNotificationRules(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = noticeSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const c = await adminCtx();
  const { data: t, error: readErr } = await c.sb.from("tenant").select("settings").eq("id", c.tenantId).single();
  if (readErr || !t) return { ok: false, error: dbMessage(readErr, "load settings") };
  const before = (t.settings as Record<string, Json>) ?? {};
  const settings = {
    ...before,
    quiet_hours: [parsed.data.quiet_from, parsed.data.quiet_to],
    weekend_reminders: parsed.data.weekend_reminders === "1",
    max_pushes_per_day: parsed.data.max_pushes_per_day,
  };
  const { error } = await c.sb.from("tenant").update({ settings }).eq("id", c.tenantId);
  if (error) return { ok: false, error: dbMessage(error, "save the reminder rules") };
  await audit(c, { action: "company.reminders", before: { quiet_hours: before.quiet_hours, weekend_reminders: before.weekend_reminders }, after: { quiet_hours: settings.quiet_hours, weekend_reminders: settings.weekend_reminders } });
  refresh();
  return { ok: true, message: "Reminder rules saved" };
}

const marketSchema = z.object({ market: z.string().trim().min(1, "Pick a market"), role: z.enum(["primary", "secondary", "travel"]).default("secondary") });

export async function addMarket(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = marketSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const c = await adminCtx();
  const { data: m } = await c.sb.from("market").select("id,name").eq("slug", parsed.data.market).maybeSingle();
  if (!m) return { ok: false, error: "Unknown market." };
  const { error } = await c.sb.from("tenant_market").upsert({ tenant_id: c.tenantId, market_id: m.id, role: parsed.data.role }, { onConflict: "tenant_id,market_id" });
  if (error) return { ok: false, error: dbMessage(error, "add the market") };
  await audit(c, { action: "company.market_added", after: { market: parsed.data.market, role: parsed.data.role } });
  refresh();
  return { ok: true, message: `${m.name} added` };
}

export async function setMarketRole(input: { market: string; role: "primary" | "secondary" | "travel" | "remove" }): Promise<AdminState> {
  const v = z.object({ market: z.string().min(1), role: z.enum(["primary", "secondary", "travel", "remove"]) }).safeParse(input);
  if (!v.success) return { ok: false, error: "Pick a market." };
  const c = await adminCtx();
  const { data: m } = await c.sb.from("market").select("id,name").eq("slug", v.data.market).maybeSingle();
  if (!m) return { ok: false, error: "Unknown market." };
  const q =
    v.data.role === "remove"
      ? c.sb.from("tenant_market").delete().eq("tenant_id", c.tenantId).eq("market_id", m.id)
      : c.sb.from("tenant_market").update({ role: v.data.role }).eq("tenant_id", c.tenantId).eq("market_id", m.id);
  const { error } = await q;
  if (error) return { ok: false, error: error.code === "23503" ? "Accounts or properties still use this market." : dbMessage(error, "change the market") };
  await audit(c, { action: v.data.role === "remove" ? "company.market_removed" : "company.market_role", after: { market: v.data.market, role: v.data.role } });
  refresh();
  return { ok: true, message: v.data.role === "remove" ? `${m.name} removed` : `${m.name}: ${v.data.role}` };
}

// --- Platform (Parks) ----------------------------------------------------------------------------------------

const companyCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter the company name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(40)
    .regex(/^[a-z0-9-]*$/, "Letters, numbers and dashes")
    .optional(),
  timezone: z.enum(TIMEZONES),
  market: z.string().trim().optional(),
  owner_email: z.string().trim().toLowerCase().email("Enter the first owner's email"),
  owner_name: z.string().trim().max(120).optional(),
  create_login: z.string().optional(),
});

/** New company: tenant (+ system lists by trigger) + primary market + first owner (invite or temporary login). */
export async function createCompany(_: AdminState, fd: FormData): Promise<AdminState> {
  const parsed = companyCreateSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const c = await adminCtx();
  if (!c.s.isPlatformAdmin) return { ok: false, error: "Only the platform admin adds companies." };
  const v = parsed.data;
  const slug = v.slug || slugify(v.name);
  if (!slug) return { ok: false, error: "Give the company a short id (slug)." };
  const admin = supabaseAdmin();
  const { data: t, error } = await admin
    .from("tenant")
    .insert({ slug, name: v.name, brand_name: v.name, kind: "client", timezone: v.timezone, settings: { weekend_reminders: false, quiet_hours: ["19:00", "07:00"], max_pushes_per_day: 3 } })
    .select("id,slug")
    .single();
  if (error || !t) return { ok: false, error: error?.code === "23505" ? `The id “${slug}” is taken — pick another.` : dbMessage(error, "create the company") };
  if (v.market) {
    const { data: m } = await admin.from("market").select("id").eq("slug", v.market).maybeSingle();
    if (m) await admin.from("tenant_market").insert({ tenant_id: t.id, market_id: m.id, role: "primary" });
  }
  let temp: string | null = null;
  if (v.create_login === "1") {
    const made = await createLogin(v.owner_email, v.owner_name ?? null);
    if ("error" in made) return { ok: false, error: `Company created, but the owner login failed: ${made.error}` };
    await admin.from("membership").insert({ tenant_id: t.id, user_id: made.userId, role: "owner" });
    temp = made.temp;
  } else {
    await admin.from("invite").insert({ tenant_id: t.id, email: v.owner_email, role: "owner", full_name: v.owner_name ?? null });
  }
  await audit(c, { action: "company.created", tenantId: t.id, targetEmail: v.owner_email, after: { name: v.name, slug, timezone: v.timezone, market: v.market ?? null } });
  refresh();
  return {
    ok: true,
    tenantSlug: t.slug,
    email: v.owner_email,
    tempPassword: temp ?? undefined,
    message: temp ? `${v.name} created · login ready for ${v.owner_email}` : `${v.name} created · ${v.owner_email} is invited as owner`,
  };
}

/** Platform admin: jump into a company (same cookie as the company switcher). */
export async function enterCompany(slug: string): Promise<AdminState> {
  const c = await adminCtx();
  if (!c.s.tenants.some((t) => t.slug === slug)) return { ok: false, error: "Unknown company." };
  const store = await cookies();
  store.set(TENANT_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  refresh();
  return { ok: true, message: "Switched", tenantSlug: slug };
}
