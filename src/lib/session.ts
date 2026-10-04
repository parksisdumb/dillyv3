import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Role } from "@/lib/domain/vocab";
import { MANAGER_ROLES } from "@/lib/domain/vocab";

export const TENANT_COOKIE = "dilly_tenant";

export type TenantRef = { id: string; slug: string; name: string; timezone: string; role: Role };

export type Session = {
  userId: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  tenants: TenantRef[];
  tenant: TenantRef;
  isManager: boolean;
};

/**
 * Resolves the signed-in user, their tenants, and the active tenant (cookie, else first membership).
 * Claims pending invites on the way in. Redirects to /login or /no-access when needed.
 * Cached per request.
 */
export const getSession = cache(async (): Promise<Session> => {
  const sb = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser();
  if (!user) {
    // Auth unreachable ≠ signed out: send them to the offline notice instead of a bare login form.
    const e = authError as { name?: string; status?: number } | null;
    const offline = !!e && (e.name === "AuthRetryableFetchError" || e.status === 0 || (e.status ?? 0) >= 500);
    // Inside a server action (Log sheet, saves) a redirect would yank the rep off the screen they're on.
    // Throw instead: the caller shows its own inline "can't reach the server" message and keeps their place.
    if (offline && (await headers()).has("next-action")) throw new Error("Can't reach the server right now.");
    redirect(offline ? "/login?offline=1" : "/login");
  }

  // Signed in with a temporary password from an admin: they pick their own before anything else.
  if (user.app_metadata?.must_change_password) redirect("/welcome/password");

  await sb.rpc("claim_invites");

  const [{ data: profile }, { data: memberships, error: membershipError }] = await Promise.all([
    sb.from("profile").select("id,email,full_name,is_platform_admin").eq("id", user.id).single(),
    sb.from("membership").select("role, tenant:tenant_id(id,slug,name,timezone)").eq("user_id", user.id).eq("active", true),
  ]);

  let tenants: TenantRef[] = (memberships ?? [])
    .filter((m) => m.tenant)
    .map((m) => {
      const t = m.tenant as unknown as { id: string; slug: string; name: string; timezone: string };
      return { ...t, role: m.role as Role };
    });

  if (profile?.is_platform_admin) {
    const { data: all } = await sb.from("tenant").select("id,slug,name,timezone").order("name");
    const have = new Set(tenants.map((t) => t.id));
    tenants = tenants.concat((all ?? []).filter((t) => !have.has(t.id)).map((t) => ({ ...t, role: "owner" as Role })));
  }
  // A failed lookup is an outage, not "no access": throw so the error screen offers Try again.
  if (membershipError) throw new Error(`Couldn't load your company: ${membershipError.message}`);
  if (tenants.length === 0) redirect("/no-access");

  const store = await cookies();
  const wanted = store.get(TENANT_COOKIE)?.value;
  const tenant = tenants.find((t) => t.slug === wanted) ?? tenants[0];

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    isPlatformAdmin: !!profile?.is_platform_admin,
    tenants,
    tenant,
    isManager: MANAGER_ROLES.includes(tenant.role),
  };
});
