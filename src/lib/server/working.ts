import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { isStaleActive } from "@/lib/lists/order";
import { daysSince } from "@/lib/domain/book";

export type WorkingRep = {
  user_id: string;
  name: string;
  active: number;
  stale: number;
  items: { propertyId: string; name: string; city: string | null; startedAt: string; lastTouchAt: string | null; days: number | null; stale: boolean }[];
};

/** Who's working what: every active pursuit per rep, last touch at the building, stale (> 21 days) flagged. */
export async function loadWorking(c: Ctx): Promise<WorkingRep[]> {
  const { sb, tenantId } = c;
  const [members, pursuits] = await Promise.all([
    getMembers(c),
    sb.from("property_pursuit").select("property_id,user_id,started_at").eq("tenant_id", tenantId).eq("status", "active").order("started_at").limit(3000),
  ]);
  const rows = pursuits.data ?? [];
  const ids = [...new Set(rows.map((r) => r.property_id))];
  const props: { id: string; name: string | null; address1: string | null; city: string | null }[] = [];
  const touches: { property_id: string | null; occurred_at: string }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const ch = ids.slice(i, i + 100);
    const [p, t] = await Promise.all([
      sb.from("property").select("id,name,address1,city").in("id", ch),
      sb.from("touch").select("property_id,occurred_at").eq("tenant_id", tenantId).in("property_id", ch).is("voided_at", null).order("occurred_at", { ascending: false }).limit(2000),
    ]);
    props.push(...(p.data ?? []));
    touches.push(...(t.data ?? []));
  }
  const pm = new Map(props.map((p) => [p.id, p]));
  const last = new Map<string, string>();
  for (const t of touches) if (t.property_id && !last.has(t.property_id)) last.set(t.property_id, t.occurred_at);
  const now = new Date();
  const reps = new Map<string, WorkingRep>();
  for (const m of members) if (["rep", "manager", "owner", "admin"].includes(m.role)) reps.set(m.user_id, { user_id: m.user_id, name: m.name, active: 0, stale: 0, items: [] });
  for (const r of rows) {
    const rep = reps.get(r.user_id);
    const p = pm.get(r.property_id);
    if (!rep || !p) continue;
    const lt = last.get(r.property_id) ?? null;
    const stale = isStaleActive({ startedAt: r.started_at, lastTouchAt: lt }, now);
    rep.items.push({ propertyId: r.property_id, name: p.name || p.address1 || "Unnamed property", city: p.city, startedAt: r.started_at, lastTouchAt: lt, days: daysSince(lt, now), stale });
    rep.active++;
    if (stale) rep.stale++;
  }
  for (const r of reps.values()) r.items.sort((a, b) => Number(b.stale) - Number(a.stale) || (a.lastTouchAt ?? "").localeCompare(b.lastTouchAt ?? ""));
  return [...reps.values()].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
}
