import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
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
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  await sb.rpc("claim_invites");

  const [{ data: profile }, { data: memberships }] = await Promise.all([
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
