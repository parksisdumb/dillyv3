import { Suspense } from "react";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { safeData } from "@/lib/server/safe";
import { FormPageSkeleton } from "@/components/status/skeletons";
import { ImportWizard, type RecentImport, type SavedMapping } from "@/components/import/import-wizard";

export const metadata: Metadata = { title: "Import" };

async function ImportBody({ entity }: { entity?: string }) {
  const c = await ctx();
  const { sb, s, tenantId, today } = c;
  const f = { tenant: tenantId };
  const [members, mappings, batches] = await Promise.all([
    getMembers(c),
    safeData(sb.from("import_mapping").select("name,header_sig,mapping,options").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(50), [], "import:mappings", f),
    safeData(
      sb
        .from("import_batch")
        .select("id,file_name,user_id,row_count,counts,status,created_at,undo_report")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(8),
      [],
      "import:batches",
      f,
    ),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const team = members.filter((m) => ["rep", "manager", "owner", "admin"].includes(m.role)).map((m) => ({ user_id: m.user_id, email: m.email, name: m.name, role: m.role }));
  const recent: RecentImport[] = batches.map((b) => ({
    id: b.id,
    fileName: b.file_name ?? "pasted rows",
    by: b.user_id ? names.get(b.user_id) ?? "A manager" : "A manager",
    rowCount: b.row_count,
    counts: (b.counts ?? {}) as Record<string, number>,
    status: b.status,
    createdAt: b.created_at,
    undoable: ["done", "failed", "running"].includes(b.status) && Date.now() - new Date(b.created_at).getTime() < 24 * 3600_000,
  }));
  return (
    <ImportWizard
      tenantName={s.tenant.name}
      year={Number(today.slice(0, 4))}
      members={team}
      me={s.userId}
      saved={mappings as unknown as SavedMapping[]}
      recent={recent}
      entity={entity === "contacts" || entity === "properties" || entity === "accounts" ? entity : null}
    />
  );
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const sp = await searchParams;
  return (
    <Suspense fallback={<FormPageSkeleton label="import" />}>
      <ImportBody entity={sp.entity} />
    </Suspense>
  );
}
