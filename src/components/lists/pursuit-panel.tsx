import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { safe } from "@/lib/server/safe";
import { getMembers } from "@/lib/server/members";
import { loadEditableLists } from "@/lib/server/lists-index";
import { PursuitToggle } from "@/components/lists/pursuit-toggle";
import { AddToListButton } from "@/components/lists/list-sheets";
import { IconList, IconTarget } from "@/components/icons";

type Kind = "property" | "account" | "contact";

async function load(kind: Kind, id: string) {
  const c = await ctx();
  const { sb, tenantId } = c;
  // Which buildings this panel is about.
  let propIds: string[] = [id];
  let names = new Map<string, string>();
  if (kind !== "property") {
    const { data } =
      kind === "account"
        ? await sb.from("property").select("id,name,address1").eq("tenant_id", tenantId).eq("account_id", id).is("duplicate_of", null).limit(200)
        : await (async () => {
            const links = await sb.from("property_contact").select("property_id").eq("tenant_id", tenantId).eq("contact_id", id).limit(50);
            const ids = (links.data ?? []).map((l) => l.property_id);
            return ids.length ? sb.from("property").select("id,name,address1").in("id", ids).is("duplicate_of", null) : { data: [] as { id: string; name: string | null; address1: string | null }[] };
          })();
    propIds = (data ?? []).map((p) => p.id);
    names = new Map((data ?? []).map((p) => [p.id, p.name || p.address1 || "Unnamed property"]));
  }
  if (!propIds.length) return { c, propIds, names, pursuits: [], members: [], onLists: [], lists: [] };
  const [pursuits, members, items, lists] = await Promise.all([
    sb.from("property_pursuit").select("property_id,user_id,started_at").eq("tenant_id", tenantId).eq("status", "active").in("property_id", propIds),
    getMembers(c),
    kind === "property" ? sb.from("list_item").select("list_id").eq("property_id", id).limit(50) : Promise.resolve({ data: [] as { list_id: string }[] }),
    kind === "property" ? safe(() => loadEditableLists(c), [], "pursuit-panel:lists", { tenant: tenantId }) : Promise.resolve([]),
  ]);
  const listIds = (items.data ?? []).map((i) => i.list_id);
  const { data: onLists } = listIds.length ? await sb.from("list").select("id,name").in("id", listIds).is("archived_at", null) : { data: [] };
  return { c, propIds, names, pursuits: pursuits.data ?? [], members, onLists: onLists ?? [], lists };
}

/**
 * Active pursuit + list membership for a property, account or contact page (one line on each page).
 *   property: my Active toggle, who else is working it, the lists it's on, Add to list.
 *   account / contact: who is actively working its buildings, with a toggle per building.
 */
export async function PursuitPanel({ kind, id, name }: { kind: Kind; id: string; name?: string }) {
  const d = await safe(() => load(kind, id), null, "pursuit-panel", { kind, id });
  if (!d) return null;
  const me = d.c.s.userId;
  const who = new Map(d.members.map((m) => [m.user_id, m.name]));
  const mine = new Set(d.pursuits.filter((p) => p.user_id === me).map((p) => p.property_id));

  if (kind === "property") {
    const others = d.pursuits.filter((p) => p.user_id !== me).map((p) => who.get(p.user_id) ?? "A teammate");
    return (
      <section aria-label="Active and lists" className="flex flex-col gap-2 px-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <PursuitToggle propertyId={id} name={name} active={mine.has(id)} className="flex-1" />
          <AddToListButton lists={d.lists} propertyIds={[id]} className="flex-1" />
        </div>
        {(others.length > 0 || d.onLists.length > 0) && (
          <p className="text-sm text-muted">
            {others.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <IconTarget size={14} className="text-accent" /> Also worked by {others.join(", ")}
                {d.onLists.length > 0 && " · "}
              </span>
            )}
            {d.onLists.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                <IconList size={14} /> On{" "}
                {d.onLists.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && ", "}
                    <Link href={`/app/lists/${l.id}`} className="underline decoration-line underline-offset-2">
                      {l.name}
                    </Link>
                  </span>
                ))}
              </span>
            )}
          </p>
        )}
      </section>
    );
  }

  if (!d.propIds.length) return null;
  // Account / contact: who's working which building.
  const byRep = new Map<string, Set<string>>();
  for (const p of d.pursuits) byRep.set(p.user_id, (byRep.get(p.user_id) ?? new Set()).add(p.property_id));
  const reps = [...byRep.entries()].map(([u, set]) => `${u === me ? "You" : who.get(u) ?? "A teammate"} (${set.size})`);
  const shown = d.propIds.slice(0, 6);
  return (
    <section aria-label="Who's working these buildings" className="mx-4 mt-3 rounded-lg border-2 border-line bg-surface">
      <div className="flex items-center gap-2 px-3 pt-2 text-sm">
        <IconTarget size={16} className="text-accent" />
        <span className="font-semibold">{reps.length ? `Actively worked by ${reps.join(", ")}` : "No one is actively working these buildings"}</span>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((pid) => (
          <li key={pid} className="flex min-h-12 items-center gap-2 pl-3 pr-1">
            {/* Plain text: the page's own Properties/Buildings section links them. */}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.names.get(pid)}</span>
            <span className="truncate text-xs text-muted">
              {d.pursuits
                .filter((p) => p.property_id === pid && p.user_id !== me)
                .map((p) => who.get(p.user_id)?.split(" ")[0] ?? "Teammate")
                .join(", ")}
            </span>
            <PursuitToggle propertyId={pid} name={d.names.get(pid)} active={mine.has(pid)} compact />
          </li>
        ))}
      </ul>
      {d.propIds.length > shown.length && <p className="px-3 pb-2 text-xs text-muted">+{d.propIds.length - shown.length} more buildings</p>}
    </section>
  );
}
