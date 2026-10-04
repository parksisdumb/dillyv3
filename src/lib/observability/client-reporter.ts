"use client";
// Tiny browser error reporter → POST /api/client-error (navigator.sendBeacon; fetch keepalive as fallback).
// Batches for 2 s, flushes when the page is hidden, caps at 25 reports per page load, drops repeats.
// Sends ids only (user, tenant) — never names, emails or what the rep typed.
import { MAX_ERRORS_PER_BATCH, type ClientError } from "@/lib/observability/client-error";

type Report = Omit<ClientError, "kind"> & { kind?: ClientError["kind"] };

const ENDPOINT = "/api/client-error";
const MAX_PER_PAGE = 25;
const queue: Report[] = [];
let sentCount = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const seen = new Set<string>();
let context: { user: string | null; tenant: string | null } = { user: null, tenant: null };
let release: string | null = null;
let installed = false;

export function setReporterContext(c: { user: string | null; tenant: string | null }) {
  context = c;
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const batch = queue.splice(0, MAX_ERRORS_PER_BATCH);
    const body = JSON.stringify({ errors: batch });
    let sent = false;
    try {
      sent = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    } catch {
      sent = false;
    }
    if (!sent) {
      try {
        void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "same-origin" }).catch(() => {});
      } catch {
        /* nothing else to try */
      }
    }
  }
}

export function reportClientError(error: unknown, extra: { kind?: ClientError["kind"]; where?: string | null; ref?: string | null; digest?: string | null } = {}) {
  try {
    if (sentCount >= MAX_PER_PAGE) return;
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : safeString(error));
    const message = (e.message || e.name || "Unknown error").slice(0, 500);
    const key = `${extra.kind ?? "error"}|${message}|${(e.stack ?? "").split("\n")[1] ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    sentCount++;
    queue.push({
      message,
      stack: e.stack?.slice(0, 4000) ?? null,
      url: typeof location !== "undefined" ? `${location.origin}${location.pathname}` : null,
      ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      release,
      kind: extra.kind ?? "error",
      where: extra.where ?? null,
      ref: extra.ref ?? null,
      digest: extra.digest ?? null,
      user: context.user,
      tenant: context.tenant,
      at: new Date().toISOString(),
    });
    if (queue.length >= MAX_ERRORS_PER_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, 2000);
  } catch {
    /* the reporter must never throw */
  }
}

function safeString(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v).slice(0, 300) : String(v);
  } catch {
    return "Unserializable rejection";
  }
}

/** Idempotent. Call once from the root layout. */
export function installClientReporter(rel: string | null) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  release = rel;
  window.addEventListener("error", (ev: ErrorEvent) => {
    // Resource load errors (img/script) bubble as plain Events without .error — not code failures.
    if (!ev.error && !ev.message) return;
    reportClientError(ev.error ?? new Error(ev.message), { kind: "error" });
  });
  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    reportClientError(ev.reason, { kind: "unhandledrejection" });
  });
  const hidden = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", flush);
}
