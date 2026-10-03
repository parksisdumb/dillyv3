import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadDataHealth } from "@/lib/server/team";
import { PageHeader, SectionTitle, Stat } from "@/components/ui/bits";

export const metadata: Metadata = { title: "Data health" };

export default async function DataHealthPage() {
  const c = await ctx();
  requireManager(c.s);
  const h = await loadDataHealth(c);
  return (
    <div>
      <PageHeader back="/app/team" title="Data health" />
      <div className="grid grid-cols-3 gap-3 px-4">
        <Stat label="Complete" value={`${h.completePct}%`} sub="properties" />
        <Stat label="Need data" value={h.propertiesIncomplete} sub={`of ${h.propertiesTotal}`} />
        <Stat label="Dupes" value={h.duplicateGroups.length} sub="contact groups" />
      </div>

      <SectionTitle>Possible duplicate contacts</SectionTitle>
      {h.duplicateGroups.length === 0 ? (
        <p className="px-4 text-sm text-muted">None found.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {h.duplicateGroups.slice(0, 100).map((g) => (
            <li key={g[0].id} className="px-4 py-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {g.map((p) => (
                  <Link key={p.id} href={`/app/contacts/${p.id}`} className="min-h-12 py-1">
                    <span className="block font-semibold underline decoration-line underline-offset-2">{p.full_name ?? "Unnamed"}</span>
                    <span className="block text-xs text-muted">{[p.email, p.mobile ?? p.phone].filter(Boolean).join(" · ") || "no email/phone"}</span>
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Properties missing roof, size or address</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface">
        {h.incompleteList.map((p) => (
          <li key={p.id}>
            <Link href={`/app/properties/${p.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name || p.address1 || "Unnamed property"}</span>
                <span className="block text-xs text-muted">
                  Missing: {[!p.address1 && "address", !p.roof_system && "roof system", !p.roof_area_sf && "roof size"].filter(Boolean).join(", ")}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {h.propertiesIncomplete > h.incompleteList.length && <p className="px-4 py-2 text-sm text-muted">Showing {h.incompleteList.length} of {h.propertiesIncomplete}.</p>}
    </div>
  );
}
