// Browser side of address suggestions: debounce + abort-the-previous-request. Talks only to our own /api/address/*.
import { MIN_QUERY, type AddressSuggestion, type LatLngBias } from "./types";

export const DEBOUNCE_MS = 250;

export type SuggestResult = { ok: true; suggestions: AddressSuggestion[] } | { ok: false; reason: "short" | "offline" | "aborted" | "error" };

/**
 * `request(q)` waits DEBOUNCE_MS; a newer call cancels the pending timer and aborts the in-flight fetch, so only the
 * latest keystroke's answer is ever delivered (older ones resolve as "aborted").
 */
export function createSuggester(opts: {
  fetchImpl?: typeof fetch;
  delayMs?: number;
  online?: () => boolean;
  session?: () => string | null;
  near?: () => LatLngBias | null;
} = {}) {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const delay = opts.delayMs ?? DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctrl: AbortController | null = null;
  let settlePending: ((r: SuggestResult) => void) | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    ctrl?.abort();
    ctrl = null;
    settlePending?.({ ok: false, reason: "aborted" });
    settlePending = null;
  };

  const request = (raw: string): Promise<SuggestResult> => {
    cancel();
    const q = raw.replace(/\s+/g, " ").trim();
    if (q.length < MIN_QUERY) return Promise.resolve({ ok: false, reason: "short" });
    if (opts.online && !opts.online()) return Promise.resolve({ ok: false, reason: "offline" });
    return new Promise<SuggestResult>((resolve) => {
      settlePending = resolve;
      timer = setTimeout(async () => {
        timer = null;
        const c = new AbortController();
        ctrl = c;
        const p = new URLSearchParams({ q });
        const s = opts.session?.();
        if (s) p.set("session", s);
        const n = opts.near?.();
        if (n) p.set("near", `${n.lat.toFixed(4)},${n.lng.toFixed(4)}`);
        let out: SuggestResult;
        try {
          const res = await f(`/api/address/suggest?${p.toString()}`, { signal: c.signal, headers: { Accept: "application/json" } });
          const body = (await res.json().catch(() => null)) as { suggestions?: AddressSuggestion[] } | null;
          out = res.ok && Array.isArray(body?.suggestions) ? { ok: true, suggestions: body!.suggestions! } : { ok: false, reason: "error" };
        } catch {
          out = { ok: false, reason: c.signal.aborted ? "aborted" : "error" };
        }
        if (ctrl === c) ctrl = null;
        if (settlePending === resolve) settlePending = null;
        // A newer request already settled this one as aborted; resolving twice is a no-op.
        resolve(c.signal.aborted ? { ok: false, reason: "aborted" } : out);
      }, delay);
    });
  };

  return { request, cancel };
}

/** Google picks: fetch components + pin for the chosen place (same session token). */
export async function fetchDetails(id: string, session: string | null, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<AddressSuggestion | null> {
  const placeId = id.replace(/^google:/, "");
  const p = new URLSearchParams({ id: placeId });
  if (session) p.set("session", session);
  try {
    const res = await fetchImpl(`/api/address/details?${p.toString()}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { suggestion?: AddressSuggestion };
    return body.suggestion ?? null;
  } catch {
    return null;
  }
}

/** A Places session token (UUID: URL-safe, 36 chars). */
export function newSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
