import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { isPartyRole } from "@/lib/domain/ownership";
import { propertyBadges, type PropertyBadge } from "@/lib/domain/badges-property";
import type { PartyRow } from "@/components/accounts/ownership";

async function accountNames(c: Ctx, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const { data } = await c.sb.from("account").select("id,name").in("id", uniq);
  return new Map((data ?? []).map((a) => [a.id, a.name]));
}

/** Every owner/manager/... row for a property (current and past), with company names. */
export async function loadPartyHistory(c: Ctx, where: { propertyId: string }): Promise<PartyRow[]> {
  const { data } = await c.sb
    .from("property_party")
    .select("id,role,account_id,started_on,ended_on,source,note")
    .eq("tenant_id", c.tenantId)
    .eq("property_id", where.propertyId)
    .order("created_at");
  const rows = (data ?? []).filter((r) => isPartyRole(r.role));
  const names = await accountNames(c, rows.map((r) => r.account_id));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as PartyRow["role"],
    account_id: r.account_id,
    account_name: names.get(r.account_id) ?? "Unknown company",
    started_on: r.started_on,
    ended_on: r.ended_on,
    source: r.source,
    note: r.note,
  }));
}

export type PastProperty = { id: string; name: string; role: string; started_on: string | null; ended_on: string; now: string | null };

/** Buildings this company used to own/manage (and no longer does). */
export async function loadPastProperties(c: Ctx, accountId: string): Promise<PastProperty[]> {
  const { data } = await c.sb
    .from("property_party")
    .select("property_id,role,started_on,ended_on")
    .eq("tenant_id", c.tenantId)
    .eq("account_id", accountId)
    .order("ended_on", { ascending: false, nullsFirst: true })
    .limit(400);
  const rows = data ?? [];
  const current = new Set(rows.filter((r) => !r.ended_on).map((r) => `${r.property_id}:${r.role}`));
  const seen = new Set<string>();
  const past = rows.filter((r) => {
    const k = `${r.property_id}:${r.role}`;
    if (!r.ended_on || current.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!past.length) return [];
  const { data: props } = await c.sb
    .from("property_current")
    .select("id,name,address1,current_manager_name,current_owner_name")
    .in("id", [...new Set(past.map((r) => r.property_id))]);
  const pm = new Map((props ?? []).map((p) => [p.id, p]));
  return past.flatMap((r) => {
    const p = pm.get(r.property_id);
    if (!p) return [];
    return [
      {
        id: r.property_id,
        name: p.name || p.address1 || "Property",
        role: r.role,
        started_on: r.started_on,
        ended_on: r.ended_on!,
        now: (r.role === "owner" ? p.current_owner_name : p.current_manager_name) ?? null,
      },
    ];
  });
}

export type EmploymentRow = { id: string; account_id: string; account_name: string; title: string | null; started_on: string | null; ended_on: string | null; note: string | null };

export async function loadEmployment(c: Ctx, contactId: string): Promise<EmploymentRow[]> {
  const { data } = await c.sb
    .from("contact_employment")
    .select("id,account_id,title,started_on,ended_on,note")
    .eq("tenant_id", c.tenantId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  const names = await accountNames(c, rows.map((r) => r.account_id));
  return rows
    .map((r) => ({ ...r, account_name: names.get(r.account_id) ?? "Unknown company" }))
    .sort((a, b) => Number(!!a.ended_on) - Number(!!b.ended_on) || (b.ended_on ?? "").localeCompare(a.ended_on ?? ""));
}

/** Badges for a set of properties (lists, queue, search, Go). One query against property_current. */
export async function loadPropertyBadges(c: Ctx, ids: (string | null | undefined)[]): Promise<Record<string, PropertyBadge[]>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return {};
  const out: Record<string, PropertyBadge[]> = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await c.sb
      .from("property_current")
      .select("id,roof_system,roof_install_year,warranty_expires_on,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at")
      .in("id", uniq.slice(i, i + 100));
    for (const r of data ?? []) if (r.id) out[r.id] = propertyBadges(r, c.today);
  }
  return out;
}
