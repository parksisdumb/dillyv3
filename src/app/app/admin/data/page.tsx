import type { Metadata } from "next";
import Link from "next/link";
import { pageBody } from "@/components/status/page-boundary";
import { adminCtx } from "@/lib/server/admin";
import { safe } from "@/lib/server/safe";
import { getMembers } from "@/lib/server/members";
import { loadDataHealth } from "@/lib/server/team";
import { listCounts, loadAssignments, loadLists } from "@/lib/server/lists";
import { updateList } from "@/lib/actions/lists";
import { agoLabel } from "@/lib/format";
import { DataSection } from "@/components/import/data-section";
import { Chip, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { RunButton } from "@/components/ui/run-button";

export const metadata: Metadata = { title: "Admin · Data" };

async function DataBody() {
  const c = await adminCtx();
  const f = { tenant: c.tenantId };
  const [members, imports, lists, health] = await Promise.all([
    safe(() => getMembers(c), [], "admin:data:members", f),
    c.sb.from("import_batch").select("id,file_name,status,created_at,counts").eq("tenant_id", c.tenantId).order("created_at", { ascending: false }).limit(8),
    safe(() => loadLists(c, { includeArchived: true }), [], "admin:data:lists", f),
    safe(() => loadDataHealth(c), null, "admin:data:health", f),
  ]);
  const [counts, assigns] = await Promise.all([
    safe(() => listCounts(c, lists.filter((l) => !l.archived_at && l.kind === "static")), new Map(), "admin:data:counts", f),
    safe(() => loadAssignments(c, lists.map((l) => l.id)), new Map(), "admin:data:assign", f),
  ]);
  const who = new Map(members.map((m) => [m.user_id, m.name]));
  return (
    <div>
      <DataSection ownerish today={c.today} members={members} />

      <SectionTitle action={<Link href="/app/import" className={btn("ghost", "sm")}>Undo an import</Link>}>Recent imports</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface text-sm">
        {(imports.data ?? []).map((b) => {
          const n = (b.counts ?? {}) as Record<string, number>;
          return (
            <li key={b.id} className="flex items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{b.file_name ?? "Pasted rows"}</span>
                <span className="block text-xs text-muted">
                  {agoLabel(b.created_at)} · {n.accounts_created ?? 0} companies, {n.contacts_created ?? 0} contacts, {n.properties_created ?? 0} properties
                </span>
              </span>
              <Chip tone={b.status === "done" ? "good" : b.status === "undone" ? "neutral" : "warn"}>{b.status}</Chip>
            </li>
          );
        })}
        {(imports.data ?? []).length === 0 && <li className="px-4 py-3 text-muted">No imports yet.</li>}
      </ul>

      <SectionTitle>Lists</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface text-sm" aria-label="All lists">
        {lists.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-4 py-2">
            <Link href={`/app/lists/${l.id}`} className="min-w-0 flex-1">
              <span className="block truncate font-semibold underline decoration-line underline-offset-2">{l.name}</span>
              <span className="block text-xs text-muted">
                {l.kind === "smart" ? "Smart" : `${counts.get(l.id)?.n ?? "—"} properties`} · {l.created_from === "system" ? "built-in" : `by ${(l.owner_user_id && who.get(l.owner_user_id)) || "—"}`}
                {(assigns.get(l.id) ?? []).length > 0 && ` · assigned to ${(assigns.get(l.id) ?? []).map((a: { user_id: string }) => who.get(a.user_id) ?? "rep").join(", ")}`}
              </span>
            </Link>
            {l.archived_at && <Chip>Archived</Chip>}
            {l.created_from !== "system" && (
              <RunButton action={updateList.bind(null, { listId: l.id, archived: !l.archived_at })} label={l.archived_at ? "Restore" : "Archive"} size="sm" variant="ghost" />
            )}
          </li>
        ))}
      </ul>

      <SectionTitle action={<Link href="/app/team/data" className={btn("ghost", "sm")}>Review</Link>}>Duplicates &amp; missing data</SectionTitle>
      <div className="mx-4 grid grid-cols-3 gap-3 rounded-lg border-2 border-line bg-surface p-3 text-sm">
        <div>
          <div className="num font-display text-2xl font-bold">{health?.duplicateGroups.length ?? "—"}</div>
          <div className="text-muted">possible duplicate contacts</div>
        </div>
        <div>
          <div className="num font-display text-2xl font-bold">{health?.propertiesIncomplete ?? "—"}</div>
          <div className="text-muted">properties missing data</div>
        </div>
        <div>
          <div className="num font-display text-2xl font-bold">{health ? `${health.completePct}%` : "—"}</div>
          <div className="text-muted">complete</div>
        </div>
      </div>
    </div>
  );
}

export default function DataPage() {
  return pageBody(() => DataBody());
}
