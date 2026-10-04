"use client";
import { useEffect } from "react";
import { installClientReporter, reportClientError, setReporterContext } from "@/lib/observability/client-reporter";
import { newId, shortRef } from "@/lib/observability/log";

/** Root layout: window.onerror + unhandledrejection → /api/client-error. */
export function ClientErrorReporter({ release }: { release: string | null }) {
  useEffect(() => installClientReporter(release), [release]);
  return null;
}

/** App shell: attach user/tenant ids (ids only) to reports. */
export function ClientErrorContext({ user, tenant }: { user: string; tenant: string }) {
  useEffect(() => setReporterContext({ user, tenant }), [user, tenant]);
  return null;
}

const refs = new WeakMap<object, string>();
/** The 8-char ref for a caught error: the server digest when there is one, else a stable per-error client id. */
export function boundaryRef(error: Error & { digest?: string }): string {
  if (error.digest) return shortRef(error.digest);
  let r = refs.get(error);
  if (!r) refs.set(error, (r = shortRef(newId())));
  return r;
}

/** One line in every error.tsx: report what the boundary caught (with the ref the rep reads out). */
export function useReportBoundary(error: Error & { digest?: string }, where: string) {
  useEffect(() => {
    reportClientError(error, { kind: "boundary", where, digest: error.digest ?? null, ref: boundaryRef(error) });
  }, [error, where]);
}
