import "server-only";
import { unstable_rethrow } from "next/navigation";
import { log, type LogFields } from "@/lib/observability/log";
import { requestInfo } from "@/lib/observability/request";

/**
 * Secondary data must never take down a page. `safe` awaits a promise (or thunk) and, if it throws,
 * logs it with the request id and returns `fallback`. Use for widgets: leaderboard, streak, goal, brief.
 *
 *   const streak = await safe(() => loadStreak(c), 0, "today:streak");
 */
export async function safe<T>(work: PromiseLike<T> | (() => PromiseLike<T> | T), fallback: T, label: string, fields: LogFields = {}): Promise<T> {
  const started = Date.now();
  try {
    return await (typeof work === "function" ? work() : work);
  } catch (err) {
    unstable_rethrow(err); // redirect() / notFound() are control flow, not failures
    log.error(`safe:${label}`, { ...(await requestInfo()), ...fields, durationMs: Date.now() - started, err });
    return fallback;
  }
}

type SbResult<T> = { data: T | null; error: unknown; count?: number | null };

/**
 * Like `safe`, for supabase-js calls (which resolve with `{ data, error }` instead of throwing).
 * Returns `data` (or `fallback` when there is an error, a throw, or null data) and logs failures.
 *
 *   const leaders = await safeData(sb.rpc("leaderboard", {...}), [], "today:leaderboard");
 */
export async function safeData<R extends SbResult<unknown>, F>(
  query: PromiseLike<R>,
  fallback: F,
  label: string,
  fields: LogFields = {},
): Promise<NonNullable<R["data"]> | F> {
  const started = Date.now();
  try {
    const res = await query;
    if (res.error) {
      log.error(`safe:${label}`, { ...(await requestInfo()), ...fields, durationMs: Date.now() - started, err: res.error });
      return fallback;
    }
    return (res.data ?? fallback) as NonNullable<R["data"]> | F;
  } catch (err) {
    unstable_rethrow(err); // redirect() / notFound() are control flow, not failures
    log.error(`safe:${label}`, { ...(await requestInfo()), ...fields, durationMs: Date.now() - started, err });
    return fallback;
  }
}

/** `safeData` for head/count queries: returns the count (or `fallback`). */
export async function safeCount(query: PromiseLike<SbResult<unknown>>, label: string, fallback = 0, fields: LogFields = {}): Promise<number> {
  const started = Date.now();
  try {
    const res = await query;
    if (res.error) {
      log.error(`safe:${label}`, { ...(await requestInfo()), ...fields, durationMs: Date.now() - started, err: res.error });
      return fallback;
    }
    return res.count ?? fallback;
  } catch (err) {
    unstable_rethrow(err); // redirect() / notFound() are control flow, not failures
    log.error(`safe:${label}`, { ...(await requestInfo()), ...fields, durationMs: Date.now() - started, err });
    return fallback;
  }
}
