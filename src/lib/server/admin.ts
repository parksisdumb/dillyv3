import "server-only";
import { notFound } from "next/navigation";
import { ctx, type Ctx } from "@/lib/server/ctx";
import { weekStart } from "@/lib/format";
import type { Actor } from "@/lib/domain/admin";

export type AdminLevel = "admin" | "readonly";

/** Owners/admins (and platform admins) manage; managers see Team read-only; everyone else gets a 404. */
export async function adminCtx(need: AdminLevel = "admin"): Promise<Ctx & { level: AdminLevel; actor: Actor }> {
  const c = await ctx();
  const r = c.s.tenant.role;
  const level: AdminLevel | null = c.s.isPlatformAdmin || r === "owner" || r === "admin" ? "admin" : r === "manager" ? "readonly" : null;
  if (!level || (need === "admin" && level !== "admin")) notFound();
  return { ...c, level, actor: { userId: c.s.userId, role: r, isPlatformAdmin: c.s.isPlatformAdmin } };
}

export type MemberRow = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastSignInAt: string | null;
  lastTouchAt: string | null;
  activeProperties: number;
  pointsWeek: number;
  ownedAccounts: number;
};

export async function loadMemberRows(c: Ctx): Promise<MemberRow[]> {
  const { sb, tenantId, today } = c;
  const { data: ms } = await sb.from("membership").select("user_id,role,active").eq("tenant_id", tenantId);
  const ids = (ms ?? []).map((m) => m.user_id);
  if (!ids.length) return [];
  const [profiles, activity, pursuits, points, accounts] = await Promise.all([
    sb.from("profile").select("id,full_name,email").in("id", ids),
    sb.rpc("tenant_member_activity", { p_tenant: tenantId }),
    sb.from("property_pursuit").select("user_id").eq("tenant_id", tenantId).eq("status", "active").limit(10000),
    sb.from("point_event").select("user_id,points").eq("tenant_id", tenantId).gte("occurred_at", `${weekStart(today)}T00:00:00`).limit(20000),
    sb.from("account").select("owner_user_id").eq("tenant_id", tenantId).in("owner_user_id", ids).is("duplicate_of", null).limit(20000),
  ]);
  const pm = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const act = new Map((activity.data ?? []).map((a) => [a.user_id, a]));
  const count = <T,>(rows: T[] | null, key: (r: T) => string | null, val: (r: T) => number = () => 1) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + val(r));
    }
    return m;
  };
  const pc = count(pursuits.data, (r) => r.user_id);
  const pts = count(points.data, (r) => r.user_id, (r) => Number(r.points ?? 0));
  const own = count(accounts.data, (r) => r.owner_user_id);
  const order = ["owner", "admin", "manager", "rep", "estimator", "pm", "reviewer"];
  return (ms ?? [])
    .map((m) => {
      const p = pm.get(m.user_id);
      const a = act.get(m.user_id);
      return {
        user_id: m.user_id,
        name: p?.full_name || p?.email || "Teammate",
        email: p?.email ?? "",
        role: m.role,
        active: m.active,
        lastSignInAt: a?.last_sign_in_at ?? null,
        lastTouchAt: a?.last_touch_at ?? null,
        activeProperties: pc.get(m.user_id) ?? 0,
        pointsWeek: pts.get(m.user_id) ?? 0,
        ownedAccounts: own.get(m.user_id) ?? 0,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
}

export type InviteRow = { id: string; email: string; role: string; full_name: string | null; created_at: string };

export async function loadPendingInvites(c: Ctx): Promise<InviteRow[]> {
  const { data } = await c.sb.from("invite").select("id,email,role,full_name,created_at").eq("tenant_id", c.tenantId).is("claimed_at", null).order("created_at", { ascending: false });
  return (data ?? []).map((i) => ({ ...i, email: String(i.email) }));
}

export type AuditRow = { id: string; action: string; actor: string; target: string | null; before: unknown; after: unknown; created_at: string };

export async function loadAudit(c: Ctx, limit = 30): Promise<AuditRow[]> {
  const { data } = await c.sb.from("admin_audit").select("id,action,actor_user_id,target_user_id,target_email,before,after,created_at").eq("tenant_id", c.tenantId).order("created_at", { ascending: false }).limit(limit);
  const ids = [...new Set((data ?? []).flatMap((r) => [r.actor_user_id, r.target_user_id]).filter((x): x is string => !!x))];
  const { data: ps } = ids.length ? await c.sb.from("profile").select("id,full_name,email").in("id", ids) : { data: [] };
  const name = new Map((ps ?? []).map((p) => [p.id, p.full_name || p.email]));
  return (data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    actor: (r.actor_user_id && name.get(r.actor_user_id)) || "Someone",
    target: (r.target_user_id && name.get(r.target_user_id)) || r.target_email,
    before: r.before,
    after: r.after,
    created_at: r.created_at,
  }));
}
