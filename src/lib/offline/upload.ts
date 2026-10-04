"use client";
// Browser → /api/media. Shared by the Log sheet, Go, property Photos, card scan and the offline replay.
import { isNetworkError } from "@/lib/offline/net";
import type { UploadResult } from "@/lib/offline/types";

export type UploadArgs = { id: string; blob: Blob; takenAt?: string | null; tenantId?: string | null; kind?: "photo" | "card" };

/** Throws on no signal (the caller queues); resolves { ok:false, retryable } for a server answer. */
export async function uploadImage(a: UploadArgs, timeoutMs = 45_000): Promise<UploadResult> {
  const fd = new FormData();
  fd.set("file", a.blob, `${a.id}.jpg`);
  fd.set("id", a.id);
  fd.set("kind", a.kind ?? "photo");
  if (a.takenAt) fd.set("at", a.takenAt);
  if (a.tenantId) fd.set("tenantId", a.tenantId);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("/api/media", { method: "POST", body: fd, credentials: "same-origin", signal: ctrl.signal });
  } catch (e) {
    if (isNetworkError(e) || (e as Error)?.name === "AbortError") throw new Error("No signal");
    throw e;
  } finally {
    clearTimeout(t);
  }
  let body: { ok?: boolean; path?: string; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* proxies / captive portals answer with HTML */
  }
  if (res.ok && body.ok && body.path) return { ok: true, path: body.path };
  // 5xx, 429, 408 and a non-JSON answer (captive portal, gateway) are worth retrying; 4xx are the rep's to fix.
  const retryable = res.status >= 500 || res.status === 429 || res.status === 408 || !body.error;
  return { ok: false, retryable, error: body.error ?? `Upload failed (${res.status})` };
}

export function newUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
    h[12] = "4";
    h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    const x = h.join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
}
