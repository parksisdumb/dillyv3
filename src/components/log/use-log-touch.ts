"use client";
import { useCallback, useRef } from "react";
import { logTouch } from "@/lib/actions/log";
import type { LogInput, LogResult } from "@/lib/actions/log-types";

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Very old WebViews: still unique enough per device for a dedupe key, formatted as a v4 uuid.
    const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
    h[12] = "4";
    h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    const x = h.join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
}

/**
 * logTouch with double-tap / bad-signal safety:
 * - every attempt carries an idempotency key; the SAME key is reused until a log succeeds, so a retry after
 *   a dropped response (or a double tap) records one touch, not two;
 * - a network failure resolves to { ok: false } with a field-friendly message instead of throwing into
 *   the error boundary and wiping the sheet.
 */
export function useLogTouch() {
  const key = useRef<{ key: string; target: string } | null>(null);
  return useCallback(async (input: LogInput): Promise<LogResult> => {
    // The key is bound to WHO/WHAT is being logged: moving to another stop or contact always starts fresh,
    // so a dropped response on stop A can never swallow the log for stop B.
    const target = [input.accountId, input.contactId, input.propertyId, input.opportunityId, input.channel].map((x) => x ?? "").join("|");
    if (!key.current || key.current.target !== target) key.current = { key: newKey(), target };
    let r: LogResult;
    try {
      r = await logTouch({ ...input, idempotencyKey: key.current.key });
    } catch {
      return { ok: false, error: "No signal — tap again. It won't double-log." };
    }
    if (r.ok) key.current = null; // the next log is a new touch
    return r;
  }, []);
}
