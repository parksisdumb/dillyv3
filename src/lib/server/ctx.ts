import "server-only";
import type { ZodError } from "zod";
import { getSession, type Session } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { localDate } from "@/lib/format";
import type { ActionState } from "@/lib/actions/state";
import { log } from "@/lib/observability/log";

export type Ctx = { s: Session; sb: Awaited<ReturnType<typeof supabaseServer>>; tenantId: string; today: string };

/** Session + typed client + active tenant id + tenant-local today. Use in every page and action. */
export async function ctx(): Promise<Ctx> {
  const [s, sb] = await Promise.all([getSession(), supabaseServer()]);
  return { s, sb, tenantId: s.tenant.id, today: localDate(s.tenant.timezone) };
}

type PgError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null;

/** Turn a Supabase/Postgres error into something a rep can read. */
export function dbMessage(e: PgError, what = "save that"): string {
  // Every server action funnels DB failures through here, so this is where they get logged.
  // Expected rejections (permission, duplicate, validation) are warnings; anything else is an error.
  const expected = !!e?.code && ["42501", "23505", "23503", "23514", "22P02", "23502", "PGRST116"].includes(e.code);
  (expected ? log.warn : log.error)("action:db", { what, err: e ?? new Error("no error object") });
  if (!e) return `Couldn't ${what}.`;
  if (!e.code && /^(AbortError|FetchError|TypeError)/.test(e.message ?? "")) {
    return `Couldn't ${what} — can't reach the server. Check your signal and try again.`;
  }
  switch (e.code) {
    case "42501":
      return `You don't have permission to ${what}.`;
    case "23505":
      return "That already exists.";
    case "23503":
      return "Something this points to no longer exists. Refresh and try again.";
    case "23514":
    case "22P02":
      return "One of the values isn't allowed.";
    case "23502":
      return "A required field is missing.";
    case "PGRST116":
      return "Not found — it may have been removed.";
  }
  if (e.message?.includes("append-only")) return "Touches can't be edited. Void and re-log instead.";
  return `Couldn't ${what}: ${e.message ?? "unknown error"}`;
}

export function fail(error: string, fields?: Record<string, string>): ActionState {
  return { ok: false, error, fields };
}

export function zodFail(err: ZodError): ActionState {
  const fields: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join(".");
    if (!fields[k]) fields[k] = i.message;
  }
  const first = err.issues[0];
  return { ok: false, error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Check the form.", fields };
}

/** FormData → plain object; empty strings become undefined so optional zod fields work. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    out[k] = t === "" ? undefined : t;
  }
  return out;
}

/** Look up a set of rows by id and return a Map — used instead of PostgREST embeds (generated types have no relationships). */
export async function byIds<T extends { id: string }>(
  query: (ids: string[]) => PromiseLike<{ data: T[] | null }>,
  ids: (string | null | undefined)[],
): Promise<Map<string, T>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return new Map();
  const { data } = await query(uniq);
  return new Map((data ?? []).map((r) => [r.id, r]));
}
