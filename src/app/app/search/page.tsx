import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { PERSONA_ROLES, type PersonaRole } from "@/lib/domain/vocab";
import { SectionTitle, StateChip, TierPill } from "@/components/ui/bits";
import { input } from "@/components/ui/styles";
import { IconBuilding, IconSearch, IconUser } from "@/components/icons";
import { propertyBadges } from "@/lib/domain/badges-property";
import { PropertyBadges } from "@/components/accounts/property-badges";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: raw } = await searchParams;
  const q = cleanQuery(raw);
  const { sb, tenantId, today } = await ctx();

  const [accounts, contacts, properties] =
    q.length >= 2
      ? await Promise.all([
          sb
            .from("account_ranked")
            .select("id,name,icp_tier,city,relationship_state")
            .eq("tenant_id", tenantId)
            .ilike("normalized_name", `%${q.toLowerCase()}%`)
            .order("rank_score", { ascending: false, nullsFirst: false })
            .limit(10),
          sb
            .from("contact")
            .select("id,full_name,title,persona_role,account_id,email")
            .eq("tenant_id", tenantId)
            .is("duplicate_of", null)
            .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,title.ilike.%${q}%,phone.ilike.%${q}%,mobile.ilike.%${q}%`)
            .limit(10),
          sb
            .from("property_current")
            .select("id,name,address1,city,account_id,current_manager_name,roof_system,roof_install_year,warranty_expires_on,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at")
            .eq("tenant_id", tenantId)
            .is("duplicate_of", null)
            .or(`name.ilike.%${q}%,address1.ilike.%${q}%,city.ilike.%${q}%`)
            .limit(10),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const acctIds = [...new Set((contacts.data ?? []).map((c) => c.account_id).filter((x): x is string => !!x))];
  const { data: an } = acctIds.length ? await sb.from("account").select("id,name").in("id", acctIds) : { data: [] };
  const names = new Map((an ?? []).map((a) => [a.id, a.name]));
  const none = q.length >= 2 && !accounts.data?.length && !contacts.data?.length && !properties.data?.length;

  return (
    <div>
      <form method="get" action="/app/search" className="px-4 pt-4" role="search">
        <label className="relative block">
          <span className="sr-only">Search accounts, contacts, properties</span>
          <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={raw ?? ""} autoFocus type="search" placeholder="Accounts, contacts, properties" className={`${input} pl-10 text-xl`} autoComplete="off" />
        </label>
      </form>
      {q.length < 2 && <p className="px-4 py-6 text-sm text-muted">Type at least 2 letters. Searches account names, contacts (name, email, phone, title) and properties (name, address, city).</p>}
      {none && <p className="px-4 py-6 text-base">Nothing matches “{q}”.</p>}

      {!!accounts.data?.length && (
        <>
          <SectionTitle action={<Link href={`/app/accounts?scope=all&q=${encodeURIComponent(q)}`} className="label inline-flex min-h-12 items-center px-2 text-xs text-accent">All accounts</Link>}>Accounts</SectionTitle>
          <ul className="divide-y divide-line border-y border-line bg-surface">
            {accounts.data.map((a) => (
              <li key={a.id}>
                <Link href={`/app/accounts/${a.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                  <TierPill tier={a.icp_tier} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.name}</span>
                    <span className="block text-sm text-muted">{a.city ?? " "}</span>
                  </span>
                  <StateChip state={a.relationship_state} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!contacts.data?.length && (
        <>
          <SectionTitle action={<Link href={`/app/contacts?scope=all&q=${encodeURIComponent(q)}`} className="label inline-flex min-h-12 items-center px-2 text-xs text-accent">All contacts</Link>}>Contacts</SectionTitle>
          <ul className="divide-y divide-line border-y border-line bg-surface">
            {contacts.data.map((c) => (
              <li key={c.id}>
                <Link href={`/app/contacts/${c.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                  <IconUser size={20} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.full_name ?? c.email ?? "Unnamed"}</span>
                    <span className="block truncate text-sm text-muted">
                      {[c.title, PERSONA_ROLES[c.persona_role as PersonaRole], c.account_id ? names.get(c.account_id) : null].filter((x) => x && x !== "Unknown").join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!properties.data?.length && (
        <>
          <SectionTitle action={<Link href={`/app/properties?q=${encodeURIComponent(q)}`} className="label inline-flex min-h-12 items-center px-2 text-xs text-accent">All properties</Link>}>Properties</SectionTitle>
          <ul className="divide-y divide-line border-y border-line bg-surface">
            {properties.data.map((p) => (
              <li key={p.id}>
                <Link href={`/app/properties/${p.id}`} className="flex min-h-14 items-start gap-3 px-4 py-2 hover:bg-surface-2">
                  <IconBuilding size={20} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name || p.address1}</span>
                    <span className="block truncate text-sm text-muted">{[p.address1, p.city, p.current_manager_name].filter(Boolean).join(", ")}</span>
                    <PropertyBadges badges={propertyBadges(p, today)} max={3} className="mt-1" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
