import "server-only";
import type { Ctx } from "@/lib/server/ctx";

export type Member = { user_id: string; name: string; role: string; email: string };

/** Active members of the tenant with display names (two queries: generated types carry no relationships). */
export async function getMembers(c: Pick<Ctx, "sb" | "tenantId">): Promise<Member[]> {
  const { data: ms } = await c.sb.from("membership").select("user_id,role").eq("tenant_id", c.tenantId).eq("active", true);
  const ids = (ms ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: ps } = await c.sb.from("profile").select("id,full_name,email").in("id", ids);
  const pm = new Map((ps ?? []).map((p) => [p.id, p]));
  return (ms ?? [])
    .map((m) => {
      const p = pm.get(m.user_id);
      return { user_id: m.user_id, role: m.role, email: p?.email ?? "", name: p?.full_name || p?.email || "Teammate" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
