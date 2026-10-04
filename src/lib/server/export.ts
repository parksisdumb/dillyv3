import "server-only";
// CSV exports. Each export is a header + an async stream of row pages read 1,000 at a time with the signed-in user's
// client (RLS applies: an export can only contain what the user could open). Filters mirror the list pages.
import type { Ctx } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { getMembers } from "@/lib/server/members";
import { ACCOUNT_TYPES, CHANNELS, ONBOARDING, OUTCOMES, PERSONA_ROLES, PREFERENCES, STAGES, SERVICE_LINES } from "@/lib/domain/vocab";
import { phoneDigitsClause } from "@/lib/domain/phone-search";
import { ageBandYears, type AgeBand } from "@/lib/domain/book";
import { propertyBadges } from "@/lib/domain/badges-property";
import { addDays, dayStartISO } from "@/lib/format";
import { DAMAGE_FLAGS } from "@/lib/lists/filter";

export const EXPORT_KINDS = ["accounts", "contacts", "properties", "opportunities", "touches"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export type ExportSpec = { header: string[]; pages: () => AsyncGenerator<unknown[][]> };

const PAGE = 1000;
type Sp = Record<string, string | undefined>;
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function* paged<T>(q: (from: number, to: number) => Page<T>): AsyncGenerator<T[]> {
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (data && data.length) yield data;
    if (!data || data.length < PAGE) return;
  }
}

async function nameMap(c: Ctx, table: "account" | "contact" | "property", ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += 150) {
    const ch = uniq.slice(i, i + 150);
    if (table === "account") for (const r of (await c.sb.from("account").select("id,name").in("id", ch)).data ?? []) out.set(r.id, r.name);
    if (table === "contact") for (const r of (await c.sb.from("contact").select("id,full_name,email").in("id", ch)).data ?? []) out.set(r.id, r.full_name ?? r.email ?? "");
    if (table === "property") for (const r of (await c.sb.from("property").select("id,name,address1").in("id", ch)).data ?? []) out.set(r.id, r.name ?? r.address1 ?? "");
  }
  return out;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const label = <T extends Record<string, unknown>>(rec: T, k: string | null | undefined): string => {
  if (!k) return "";
  const v = rec[k as keyof T] as unknown;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "label" in v) return String((v as { label: string }).label);
  return k;
};

export async function buildExport(c: Ctx, kind: ExportKind, sp: Sp): Promise<ExportSpec> {
  const { sb, s, tenantId, today } = c;
  const members = await getMembers(c);
  const who = new Map(members.map((m) => [m.user_id, m]));
  const ownerName = (id: string | null) => (id ? who.get(id)?.name ?? "" : "");
  const ownerEmail = (id: string | null) => (id ? who.get(id)?.email ?? "" : "");
  const myAccountIds = async () => {
    const ids: string[] = [];
    for await (const p of paged((f, t) => sb.from("account").select("id").eq("tenant_id", tenantId).eq("owner_user_id", s.userId).order("id").range(f, t))) ids.push(...p.map((r) => r.id));
    return ids;
  };

  switch (kind) {
    case "accounts": {
      const q = cleanQuery(sp.q);
      return {
        header: ["Name", "Type", "Tier", "Status", "Owner", "Owner email", "Phone", "Website", "Address", "City", "State", "Zip", "Onboarding", "Preference", "Preference reason", "Last touch", "Days since touch", "Properties", "Contacts", "Open opportunities", "Open value", "Source", "Created", "Dilly id"],
        pages: async function* () {
          for await (const rows of paged((f, t) => {
            let x = sb
              .from("account_ranked")
              .select("id,name,account_type,icp_tier,relationship_state,owner_user_id,phone,website,address1,city,state,zip,onboarding_status,preference,preference_reason,last_touch_at,days_since_touch,property_count,contact_count,open_opps,open_value,source,created_at")
              .eq("tenant_id", tenantId)
              .eq("is_test", false);
            if (sp.scope !== "all") x = x.eq("owner_user_id", s.userId);
            if (q) x = x.ilike("normalized_name", `%${q.toLowerCase()}%`);
            if (sp.state === "excluded") x = x.in("relationship_state", ["excluded", "do_not_pursue"]);
            else if (sp.state) x = x.eq("relationship_state", sp.state);
            if (sp.type && sp.type in ACCOUNT_TYPES) x = x.eq("account_type", sp.type);
            if (sp.tier && /^[1-4]$/.test(sp.tier)) x = x.eq("icp_tier", Number(sp.tier));
            return x.order("name").order("id").range(f, t);
          })) {
            yield rows.map((a) => [
              a.name,
              label(ACCOUNT_TYPES, a.account_type),
              `P${a.icp_tier ?? 3}`,
              a.relationship_state,
              ownerName(a.owner_user_id),
              ownerEmail(a.owner_user_id),
              a.phone,
              a.website,
              a.address1,
              a.city,
              a.state,
              a.zip,
              label(ONBOARDING, a.onboarding_status),
              label(PREFERENCES, a.preference),
              a.preference_reason,
              day(a.last_touch_at),
              a.days_since_touch,
              a.property_count,
              a.contact_count,
              a.open_opps,
              a.open_value,
              a.source,
              day(a.created_at),
              a.id,
            ]);
          }
        },
      };
    }

    case "contacts": {
      const term = cleanQuery(sp.q);
      const mine = sp.scope === "all" ? null : new Set(await myAccountIds());
      return {
        header: ["First name", "Last name", "Full name", "Title", "Role", "Company", "Email", "Phone", "Mobile", "Email status", "Do not contact", "Last touch", "Source", "Created", "Dilly id"],
        pages: async function* () {
          if (mine && mine.size === 0) return;
          for await (const rows of paged((f, t) => {
            let x = sb
              .from("contact")
              .select("id,first_name,last_name,full_name,title,persona_role,account_id,email,phone,mobile,email_status,do_not_contact,last_touch_at,source,created_at")
              .eq("tenant_id", tenantId)
              .is("duplicate_of", null)
              .eq("is_test", false);
            if (mine && mine.size <= 150) x = x.in("account_id", [...mine]);
            if (term) x = x.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,title.ilike.%${term}%,phone.ilike.%${term}%,mobile.ilike.%${term}%${phoneDigitsClause(term)}`);
            if (sp.role && sp.role in PERSONA_ROLES) x = x.eq("persona_role", sp.role);
            if (sp.show === "never") x = x.is("last_touch_at", null);
            if (sp.show === "email") x = x.not("email", "is", null);
            if (sp.show === "phone") x = x.or("phone.not.is.null,mobile.not.is.null");
            if (sp.show === "bounced") x = x.eq("email_status", "bounced");
            if (sp.show === "quiet") x = x.lt("last_touch_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
            return x.order("full_name", { nullsFirst: false }).order("id").range(f, t);
          })) {
            const kept = mine && mine.size > 150 ? rows.filter((r) => r.account_id && mine.has(r.account_id)) : rows;
            const names = await nameMap(c, "account", kept.map((r) => r.account_id));
            yield kept.map((r) => [
              r.first_name,
              r.last_name,
              r.full_name,
              r.title,
              label(PERSONA_ROLES, r.persona_role),
              r.account_id ? names.get(r.account_id) ?? "" : "",
              r.email,
              r.phone,
              r.mobile,
              r.email_status,
              r.do_not_contact ? "yes" : "",
              day(r.last_touch_at),
              r.source,
              day(r.created_at),
              r.id,
            ]);
          }
        },
      };
    }

    case "properties": {
      const term = cleanQuery(sp.q);
      const year = Number(today.slice(0, 4));
      const mine = sp.scope === "mine" ? new Set(await myAccountIds()) : null;
      let marketId: string | null = null;
      if (sp.market) marketId = (await sb.from("market").select("id").eq("slug", sp.market).maybeSingle()).data?.id ?? null;
      return {
        header: ["Name", "Address", "City", "State", "Zip", "Asset class", "Roof system", "Roof install year", "Roof sq ft", "Units", "Warranty expires", "Current manager", "Current owner", "Badges", "Open opportunities", "Open value", "Source", "Created", "Dilly id"],
        pages: async function* () {
          if (mine && mine.size === 0) return;
          for await (const rows of paged((f, t) => {
            let x = sb
              .from("property_current")
              .select("id,name,address1,city,state,zip,asset_class,roof_system,roof_install_year,roof_area_sf,warranty_expires_on,account_id,current_manager_name,current_owner_name,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at,open_opp_count,open_opp_value,source,created_at")
              .eq("tenant_id", tenantId)
              .is("duplicate_of", null)
              .eq("is_test", false);
            if (mine && mine.size <= 150) x = x.in("account_id", [...mine]);
            if (term) x = x.or(`name.ilike.%${term}%,address1.ilike.%${term}%,city.ilike.%${term}%`);
            if (sp.city) x = x.ilike("city", cleanQuery(sp.city));
            if (marketId) x = x.eq("market_id", marketId);
            if (sp.asset) x = x.ilike("asset_class", cleanQuery(sp.asset));
            if (sp.roof) x = x.ilike("roof_system", cleanQuery(sp.roof));
            const band = sp.age as AgeBand | undefined;
            if (band === "unknown") x = x.is("roof_install_year", null);
            else if (band === "lt10" || band === "10to15" || band === "15to20" || band === "20plus") {
              const { min, max } = ageBandYears(band, year);
              if (min != null) x = x.gte("roof_install_year", min);
              if (max != null) x = x.lte("roof_install_year", max);
            }
            if (sp.warranty === "1") x = x.gte("warranty_expires_on", today).lte("warranty_expires_on", addDays(today, 365));
            if (sp.noacct === "1") x = x.is("account_id", null);
            if (sp.incomplete === "1") x = x.or("roof_system.is.null,address1.is.null,roof_area_sf.is.null");
            if (sp.opp === "1") x = x.gt("open_opp_count", 0);
            if (sp.cond === "damage") x = x.overlaps("active_flags", [...DAMAGE_FLAGS]);
            if (sp.cond === "leak") x = x.contains("active_flags", ["active_leak"]);
            if (sp.newmgmt === "1") x = x.gte("management_changed_on", addDays(today, -90));
            if (sp.storm === "1") x = x.not("storm_kind", "is", null);
            return x.order("name", { nullsFirst: false }).order("id").range(f, t);
          })) {
            const kept = rows.filter((r) => r.id && (!mine || mine.size <= 150 || (r.account_id && mine.has(r.account_id))));
            const units = new Map<string, number | null>();
            const ids = kept.map((r) => r.id!);
            for (let i = 0; i < ids.length; i += 150) {
              for (const u of (await sb.from("property").select("id,unit_count").in("id", ids.slice(i, i + 150))).data ?? []) units.set(u.id, u.unit_count);
            }
            yield kept.map((r) => [
              r.name,
              r.address1,
              r.city,
              r.state,
              r.zip,
              r.asset_class,
              r.roof_system,
              r.roof_install_year,
              r.roof_area_sf,
              units.get(r.id!) ?? "",
              r.warranty_expires_on,
              r.current_manager_name,
              r.current_owner_name,
              propertyBadges(r, today).map((b) => b.label),
              r.open_opp_count,
              r.open_opp_value,
              r.source,
              day(r.created_at),
              r.id,
            ]);
          }
        },
      };
    }

    case "opportunities": {
      return {
        header: ["Name", "Stage", "Service line", "Value", "Gross profit", "Company", "Property", "Primary contact", "Owner", "Next step", "Next step due", "Stage changed", "Won", "Lost", "Lost reason", "Source", "Created", "Dilly id"],
        pages: async function* () {
          for await (const rows of paged((f, t) => {
            let x = sb
              .from("opportunity")
              .select("id,name,stage,service_line,value_estimate,gross_profit_estimate,account_id,property_id,primary_contact_id,owner_user_id,next_step,next_step_due,stage_changed_at,won_at,lost_at,lost_reason,source,created_at")
              .eq("tenant_id", tenantId)
              .eq("is_test", false);
            if (sp.scope === "mine") x = x.eq("owner_user_id", s.userId);
            if (sp.stage && sp.stage in STAGES) x = x.eq("stage", sp.stage);
            if (sp.open === "1") x = x.not("stage", "in", "(won,lost)");
            return x.order("created_at", { ascending: false }).order("id").range(f, t);
          })) {
            const [an, pn, cn] = await Promise.all([
              nameMap(c, "account", rows.map((r) => r.account_id)),
              nameMap(c, "property", rows.map((r) => r.property_id)),
              nameMap(c, "contact", rows.map((r) => r.primary_contact_id)),
            ]);
            yield rows.map((o) => [
              o.name,
              label(STAGES, o.stage),
              label(SERVICE_LINES, o.service_line),
              o.value_estimate,
              o.gross_profit_estimate,
              o.account_id ? an.get(o.account_id) ?? "" : "",
              o.property_id ? pn.get(o.property_id) ?? "" : "",
              o.primary_contact_id ? cn.get(o.primary_contact_id) ?? "" : "",
              ownerName(o.owner_user_id),
              o.next_step,
              o.next_step_due,
              day(o.stage_changed_at),
              day(o.won_at),
              day(o.lost_at),
              o.lost_reason,
              o.source,
              day(o.created_at),
              o.id,
            ]);
          }
        },
      };
    }

    case "touches": {
      // Whole-team touch history is owners/admins only; managers export their own.
      const admin = s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin;
      const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
      const from = valid(sp.from) ?? addDays(today, -29);
      const to = valid(sp.to) ?? today;
      const tz = s.tenant.timezone;
      const rep = admin ? (sp.rep && who.has(sp.rep) ? sp.rep : null) : s.userId;
      return {
        header: ["Date", "Time", "Rep", "Channel", "Outcome", "Company", "Contact", "Property", "Notes", "First touch", "Source", "Voided", "Dilly id"],
        pages: async function* () {
          for await (const rows of paged((f, t) => {
            let x = sb
              .from("touch")
              .select("id,occurred_at,user_id,channel,outcome,account_id,contact_id,property_id,notes,is_first_touch,source,voided_at")
              .eq("tenant_id", tenantId)
              .gte("occurred_at", dayStartISO(from, tz))
              .lt("occurred_at", dayStartISO(addDays(to, 1), tz));
            if (rep) x = x.eq("user_id", rep);
            return x.order("occurred_at").order("id").range(f, t);
          })) {
            const [an, cn, pn] = await Promise.all([
              nameMap(c, "account", rows.map((r) => r.account_id)),
              nameMap(c, "contact", rows.map((r) => r.contact_id)),
              nameMap(c, "property", rows.map((r) => r.property_id)),
            ]);
            const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
            yield rows.map((r) => {
              const parts = Object.fromEntries(fmt.formatToParts(new Date(r.occurred_at)).map((p) => [p.type, p.value]));
              return [
                `${parts.year}-${parts.month}-${parts.day}`,
                `${parts.hour}:${parts.minute}`,
                ownerName(r.user_id),
                label(CHANNELS, r.channel),
                label(OUTCOMES, r.outcome),
                r.account_id ? an.get(r.account_id) ?? "" : "",
                r.contact_id ? cn.get(r.contact_id) ?? "" : "",
                r.property_id ? pn.get(r.property_id) ?? "" : "",
                r.notes,
                r.is_first_touch ? "yes" : "",
                r.source,
                r.voided_at ? "yes" : "",
                r.id,
              ];
            });
          }
        },
      };
    }
  }
}
