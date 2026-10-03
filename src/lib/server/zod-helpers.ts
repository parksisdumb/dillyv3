import { z } from "zod";

/** z.enum from an object's keys (the vocab maps). */
export function keysEnum<T extends Record<string, unknown>>(rec: T) {
  return z.enum(Object.keys(rec) as [keyof T & string, ...(keyof T & string)[]]);
}

export const uuid = z.string().uuid();
export const optUuid = z.string().uuid().optional().nullable();
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
export const optText = (max = 2000) => z.string().trim().max(max).optional().nullable();

/** Strip characters that would break a PostgREST filter expression. */
export function cleanQuery(q: string | null | undefined): string {
  return (q ?? "").replace(/[,()%*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** "Dave Smith Jr" → { first: "Dave", last: "Smith Jr" } */
export function splitName(full: string): { first_name: string | null; last_name: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { first_name: null, last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") || null };
}
