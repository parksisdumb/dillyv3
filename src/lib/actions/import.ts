"use server";
// CSV import: the browser parses and plans (src/lib/domain/import/*); these actions load what the plan dedupes
// against and commit it in chunks through the import_* RPCs (20261004200000_import_assign_scorecard.sql).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import type { ExistingIndex } from "@/lib/domain/import/plan";
import { FIELD_KEYS } from "@/lib/domain/import/fields";
import type { Json } from "@/lib/db/database.types";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

const PAGE = 1000;

async function managerCtx() {
  const c = await ctx();
  if (!c.s.isManager) throw new Error("Only owners, admins and managers can import.");
  return c;
}

/** Everything the plan dedupes against, paged (PostgREST caps a response). RLS-scoped to the active tenant. */
export async function loadImportIndex(): Promise<Ok<{ index: ExistingIndex }> | Err> {
  try {
    const { sb, tenantId } = await managerCtx();
    async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
      const out: T[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await q(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) return out;
      }
    }
    const [accounts, contacts, properties] = await Promise.all([
      all((f, t) => sb.from("account").select("id,name,normalized_name,owner_user_id").eq("tenant_id", tenantId).is("duplicate_of", null).order("id").range(f, t)),
      all((f, t) => sb.from("contact").select("id,full_name,email,phone_digits,account_id").eq("tenant_id", tenantId).is("duplicate_of", null).order("id").range(f, t)),
      all((f, t) =>
        sb.from("property").select("id,name,address1,city,normalized_address,account_id").eq("tenant_id", tenantId).is("duplicate_of", null).order("id").range(f, t),
      ),
    ]);
    return { ok: true, index: { accounts, contacts: contacts.map((c) => ({ ...c, email: c.email as string | null })), properties } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load your records." };
  }
}

const beginSchema = z.object({
  fileName: z.string().trim().max(200),
  rowCount: z.number().int().min(1).max(20000),
  mapping: z.record(z.string(), z.enum(FIELD_KEYS as [string, ...string[]])),
  options: z.record(z.string(), z.unknown()),
});

export async function beginImport(input: z.input<typeof beginSchema>): Promise<Ok<{ batchId: string }> | Err> {
  const v = beginSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "Check the import settings." };
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb.rpc("import_begin", {
    p_tenant: tenantId,
    p_file_name: v.data.fileName || "pasted rows",
    p_mapping: v.data.mapping as Json,
    p_options: v.data.options as Json,
    p_row_count: v.data.rowCount,
  });
  if (error || !data) return { ok: false, error: dbMessage(error, "start the import") };
  return { ok: true, batchId: String(data) };
}

const chunkSchema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["accounts", "contacts", "properties"]),
  rows: z.array(z.record(z.string(), z.unknown())).max(1000),
});

/** One chunk = one RPC = one transaction. Returns client key → record id. */
export async function importChunk(input: z.input<typeof chunkSchema>): Promise<Ok<{ ids: Record<string, string> }> | Err> {
  const v = chunkSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "That chunk didn't look right." };
  const { sb } = await ctx();
  const fn = v.data.kind === "accounts" ? "import_accounts" : v.data.kind === "contacts" ? "import_contacts" : "import_properties";
  const { data, error } = await sb.rpc(fn, { p_batch: v.data.batchId, p_rows: v.data.rows as Json });
  if (error) return { ok: false, error: rpcMessage(error, `import ${v.data.kind}`) };
  return { ok: true, ids: (data ?? {}) as Record<string, string> };
}

export async function finishImport(
  batchId: string,
  status: "done" | "failed",
  counts: Record<string, number>,
  err?: string,
  /** Every building the import created or linked: they become the "Import — <file> — <date>" list. */
  propertyIds: string[] = [],
): Promise<Ok<{ counts: Record<string, number>; listId?: string }> | Err> {
  if (!z.string().uuid().safeParse(batchId).success) return { ok: false, error: "Unknown import." };
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("import_finish", { p_batch: batchId, p_status: status, p_counts: counts as Json, p_error: err });
  if (error) return { ok: false, error: rpcMessage(error, "finish the import") };
  let listId: string | undefined;
  if (status === "done") {
    const pids = z.array(z.string().uuid()).max(20000).safeParse(propertyIds);
    const made = await sb.rpc("list_from_import", { p_batch: batchId, p_properties: pids.success ? pids.data : [] });
    // A list is a convenience: the import itself already succeeded.
    if (made.error) dbMessage(made.error, "make the import list");
    else listId = String(made.data);
  }
  revalidatePath("/app", "layout");
  return { ok: true, counts: (data ?? {}) as Record<string, number>, listId };
}

export type UndoReport = {
  deleted: { accounts: number; contacts: number; properties: number; links: number };
  kept: { accounts: { id: string; name: string }[]; contacts: { id: string; name: string }[]; properties: { id: string; name: string }[] };
};

export async function undoImport(batchId: string): Promise<Ok<{ report: UndoReport }> | Err> {
  if (!z.string().uuid().safeParse(batchId).success) return { ok: false, error: "Unknown import." };
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("import_undo", { p_batch: batchId });
  if (error) return { ok: false, error: rpcMessage(error, "undo the import") };
  // The import's list keeps whatever buildings stayed; archive it when nothing did.
  const { data: lists } = await sb.from("list").select("id").eq("import_batch_id", batchId).is("archived_at", null);
  for (const l of lists ?? []) {
    const { count } = await sb.from("list_item").select("property_id", { count: "exact", head: true }).eq("list_id", l.id);
    if (!count) await sb.from("list").update({ archived_at: new Date().toISOString() }).eq("id", l.id);
  }
  revalidatePath("/app", "layout");
  return { ok: true, report: data as unknown as UndoReport };
}

const mappingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  headerSig: z.string().min(1).max(4000),
  mapping: z.record(z.string(), z.enum(FIELD_KEYS as [string, ...string[]])),
  options: z.record(z.string(), z.unknown()),
});

export async function saveImportMapping(input: z.input<typeof mappingSchema>): Promise<Ok<{ message: string }> | Err> {
  const v = mappingSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "Name the mapping." };
  const { sb, s, tenantId } = await ctx();
  if (!s.isManager) return { ok: false, error: "Only owners, admins and managers can save mappings." };
  const { error } = await sb.from("import_mapping").upsert(
    {
      tenant_id: tenantId,
      name: v.data.name,
      header_sig: v.data.headerSig,
      mapping: v.data.mapping as Json,
      options: v.data.options as Json,
      created_by: s.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,header_sig" },
  );
  if (error) return { ok: false, error: dbMessage(error, "save the mapping") };
  return { ok: true, message: `Mapping “${v.data.name}” saved — it applies automatically next time.` };
}

type PgErr = { code?: string; message?: string } | null;
function rpcMessage(e: PgErr, what: string): string {
  if (e?.code && ["P0001", "P0002", "22023", "23514", "42501"].includes(e.code) && e.message) {
    const m = e.message.replace(/^ERROR:\s*/, "");
    return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
  }
  return dbMessage(e, what);
}
