import "server-only";
import { headers } from "next/headers";
import { log, REQUEST_ID_HEADER, type LogFields } from "@/lib/observability/log";

/**
 * Request id + route for the current server request (set by middleware as x-request-id / x-pathname).
 * Never throws: outside a request scope (cron, tests) it returns nulls.
 */
export async function requestInfo(): Promise<{ requestId: string | null; route: string | null }> {
  try {
    const h = await headers();
    return { requestId: h.get(REQUEST_ID_HEADER), route: h.get("x-pathname") };
  } catch {
    return { requestId: null, route: null };
  }
}

/** Logger bound to the current request (plus any extra fields such as tenant/user). */
export async function requestLog(extra: LogFields = {}) {
  return log.with({ ...(await requestInfo()), ...extra });
}
