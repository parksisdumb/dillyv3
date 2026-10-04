/**
 * fetch for Supabase clients (`global.fetch`): a per-attempt timeout so a slow database never hangs a
 * render, and ONE retry for idempotent reads on a network error or gateway 5xx. Writes are never retried.
 *
 * Pair with `db: { retry: false }` on the client so postgrest-js's own retry (3× with 1/2/4 s backoff)
 * doesn't stack on top of this one — the worst case stays bounded at ~2 × timeout.
 *
 * Works in Node, Edge and the browser. No dependencies.
 */
import { log } from "@/lib/observability/log";

/** Read-only RPCs (called with POST, but safe to repeat). Keep in sync with stable SQL functions. */
const READ_RPCS = new Set(["rep_queue", "rep_streak", "leaderboard", "find_similar_contacts", "health"]);
const RETRY_STATUS = new Set([502, 503, 504, 520, 522, 524]);

export type ResilientFetchOptions = {
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts for idempotent requests (0 = never retry). */
  retries?: number;
  /** Delay before a retry. */
  retryDelayMs?: number;
  /** Where the client lives, for logs ("server", "admin", "middleware", "browser"). */
  label?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
};

export class SupabaseTimeoutError extends Error {
  constructor(ms: number, path: string) {
    super(`Supabase request timed out after ${ms}ms (${path})`);
    // postgrest-js treats AbortError as "aborted (timeout or manual cancellation)" and returns it as { error }.
    this.name = "AbortError";
  }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
}

function pathOf(input: RequestInfo | URL): string {
  try {
    const u = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    return u.pathname; // never the query string: it carries filter values (names, emails)
  } catch {
    return "?";
  }
}

/** True when repeating the request cannot change data. */
export function isIdempotent(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (method === "POST") {
    const m = path.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)$/i);
    if (m && READ_RPCS.has(m[1])) return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function resilientFetch(opts: ResilientFetchOptions = {}): typeof fetch {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  const label = opts.label ?? "supabase";

  return async function dillyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const impl = opts.fetchImpl ?? globalThis.fetch;
    const method = methodOf(input, init);
    const path = pathOf(input);
    const canRetry = retries > 0 && isIdempotent(method, path) && !(init?.body instanceof ReadableStream);
    const outer = init?.signal ?? (typeof input === "object" && "signal" in input ? input.signal : undefined);
    const maxAttempts = canRetry ? 1 + retries : 1;

    for (let attempt = 1; ; attempt++) {
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      const onOuterAbort = () => ctrl.abort();
      if (outer) {
        if (outer.aborted) ctrl.abort();
        else outer.addEventListener("abort", onOuterAbort, { once: true });
      }
      const started = Date.now();
      try {
        const res = await impl(input, { ...init, signal: ctrl.signal });
        if (attempt < maxAttempts && RETRY_STATUS.has(res.status)) {
          log.warn("supabase:retry", { label, method, path, status: res.status, attempt, durationMs: Date.now() - started });
          try {
            await res.body?.cancel();
          } catch {
            /* drained */
          }
          await sleep(retryDelayMs);
          continue;
        }
        return res;
      } catch (e) {
        if (outer?.aborted) throw e; // caller cancelled: not ours to retry or relabel
        const err = timedOut ? new SupabaseTimeoutError(timeoutMs, path) : e;
        if (attempt < maxAttempts) {
          log.warn("supabase:retry", { label, method, path, attempt, durationMs: Date.now() - started, err });
          await sleep(retryDelayMs);
          continue;
        }
        log.error(timedOut ? "supabase:timeout" : "supabase:network", { label, method, path, attempt, durationMs: Date.now() - started, err });
        throw err;
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuterAbort);
      }
    }
  };
}

/** Default per-attempt timeout (ms) — override with DILLY_SUPABASE_TIMEOUT_MS. */
export function defaultTimeoutMs(): number {
  const n = Number(typeof process !== "undefined" ? process.env?.DILLY_SUPABASE_TIMEOUT_MS : undefined);
  return Number.isFinite(n) && n >= 1000 ? n : 8_000;
}
