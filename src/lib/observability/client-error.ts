// Browser error reports (POST /api/client-error): payload contract, size limits and the per-IP token bucket. Pure.
import { z } from "zod";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_ERRORS_PER_BATCH = 10;

const str = (max: number) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .nullish();

export const clientErrorSchema = z.object({
  message: z.string().min(1).transform((s) => s.slice(0, 500)),
  stack: str(4000),
  url: str(500),
  ua: str(300),
  release: str(64),
  kind: z.enum(["error", "unhandledrejection", "boundary"]).default("error"),
  where: str(60),
  ref: str(16),
  digest: str(64),
  /** Ids only: no names, emails or form contents ever leave the phone in a report. */
  user: z.string().uuid().nullish(),
  tenant: z.string().uuid().nullish(),
  at: str(40),
});
export type ClientError = z.infer<typeof clientErrorSchema>;

export const clientErrorBatchSchema = z.object({ errors: z.array(clientErrorSchema).min(1).max(MAX_ERRORS_PER_BATCH) });

/** Query strings can carry tokens (magic links, OAuth codes): keep origin + path only. */
export function scrubUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u.split(/[?#]/)[0].slice(0, 500);
  }
}

export type ParseResult = { ok: true; errors: ClientError[] } | { ok: false; status: 400 | 413; error: string };

export function parseClientErrors(raw: string): ParseResult {
  if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "too_large" };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "bad_json" };
  }
  // A single error object is accepted too.
  const shaped = body && typeof body === "object" && !Array.isArray(body) && !("errors" in body) ? { errors: [body] } : body;
  const p = clientErrorBatchSchema.safeParse(shaped);
  if (!p.success) return { ok: false, status: 400, error: "invalid" };
  return { ok: true, errors: p.data.errors.map((e) => ({ ...e, url: scrubUrl(e.url) })) };
}

/** Token bucket per key (IP). In-memory per server instance — enough to stop a looping page from flooding logs. */
export function tokenBuckets(opts: { capacity: number; refillPerSec: number; maxKeys?: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 5000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key: string, cost = 1): boolean {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) {
          // Drop the oldest entry (Map keeps insertion order).
          const first = buckets.keys().next().value;
          if (first !== undefined) buckets.delete(first);
        }
        b = { tokens: opts.capacity, at: t };
      } else {
        b.tokens = Math.min(opts.capacity, b.tokens + ((t - b.at) / 1000) * opts.refillPerSec);
        b.at = t;
      }
      buckets.delete(key);
      buckets.set(key, b);
      if (b.tokens < cost) return false;
      b.tokens -= cost;
      return true;
    },
    size: () => buckets.size,
  };
}

export function clientIp(h: { get(name: string): string | null }): string {
  const xf = h.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim().slice(0, 64);
  return (h.get("x-real-ip") ?? "unknown").slice(0, 64);
}
