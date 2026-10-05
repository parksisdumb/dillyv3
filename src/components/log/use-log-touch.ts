"use client";
import { useCallback, useRef } from "react";
import { logTouch } from "@/lib/actions/log";
import type { LogInput, LogResult } from "@/lib/actions/log-types";
import type { MediaItem } from "@/lib/storage/paths";
import { useOfflineQueue, queuedLabel } from "@/components/offline/offline-queue";
import { definitelyOffline } from "@/lib/offline/net";
import { newUuid, uploadImage } from "@/lib/offline/upload";
import type { PendingPhoto } from "@/components/photos/photo-picker";
import type { QueuedLog } from "@/lib/offline/types";

/** A log saved on the phone (no signal). It sends itself later with the same idempotency key. */
export type QueuedOutcome = { ok: true; queued: true; pending: number; points: 0; toast: string };
export type LogOutcome = LogResult | QueuedOutcome;
export const isQueued = (r: LogOutcome): r is QueuedOutcome => r.ok && "queued" in r;

export type LogOptions = {
  photos?: PendingPhoto[];
  /** What the queue sheet shows ("Site visit · Greystar Riverside") and where "Open" goes. */
  label?: string;
  href?: string | null;
};

const toMedia = (p: PendingPhoto & { path: string }): MediaItem => ({
  kind: "photo",
  id: p.id,
  path: p.path,
  width: p.width,
  height: p.height,
  taken_at: p.takenAt,
  lat: p.lat ?? null,
  lng: p.lng ?? null,
  caption: p.caption || null,
});

/** What the queue keeps: the log itself; key, photos, time and company are stored alongside and re-applied on replay. */
function stripTransport(input: LogInput): QueuedLog["input"] {
  const copy = { ...input };
  delete copy.idempotencyKey;
  delete copy.media;
  delete copy.occurredAt;
  delete copy.tenantId;
  return copy;
}

/**
 * logTouch with field-grade safety:
 * - every attempt carries an idempotency key; the SAME key is reused until the log succeeds (or is queued), so a
 *   retry after a dropped response (or a double tap) records one touch, not two;
 * - photos upload first (idempotent keys), then the log carries them in touch.media;
 * - no signal (offline, fetch fails, server can't reach the DB) → the log and its photos are saved on the phone
 *   (IndexedDB) and replayed automatically, in order, with the same key. Nothing throws into the error boundary.
 */
export function useLogTouch() {
  const queue = useOfflineQueue();
  const key = useRef<{ key: string; target: string; at: string } | null>(null);
  return useCallback(
    async (input: LogInput, opts: LogOptions = {}): Promise<LogOutcome> => {
      // The key is bound to WHO/WHAT is being logged: moving to another stop or contact always starts fresh,
      // so a dropped response on stop A can never swallow the log for stop B.
      const target = [input.accountId, input.contactId, input.propertyId, input.opportunityId, input.appointmentId, input.channel].map((x) => x ?? "").join("|");
      if (!key.current || key.current.target !== target) key.current = { key: newUuid(), target, at: new Date().toISOString() };
      const { key: k, at } = key.current;
      const photos = opts.photos ?? [];

      const saveOnPhone = async (): Promise<LogOutcome> => {
        if (!queue) return { ok: false, error: "No signal — tap again. It won't double-log." };
        try {
          const pending = await queue.enqueue({
            key: k,
            // A post-dated log keeps its chosen time; otherwise the time of the tap.
            createdAt: input.occurredAt ?? at,
            input: stripTransport(input),
            photos: await Promise.all(
              photos.map(async (p) => ({
                id: p.id,
                bytes: await p.blob.arrayBuffer(),
                type: p.blob.type || "image/jpeg",
                width: p.width,
                height: p.height,
                takenAt: p.takenAt,
                lat: p.lat ?? null,
                lng: p.lng ?? null,
                caption: p.caption || null,
                path: p.path ?? null,
              })),
            ),
            label: opts.label ?? "Logged touch",
            href: opts.href ?? null,
          });
          key.current = null; // the next log is a new touch
          return { ok: true, queued: true, pending, points: 0, toast: `Saved on this phone · ${queuedLabel(pending)}` };
        } catch {
          return { ok: false, error: "No signal, and this phone couldn't save the log. Tap again when you have bars." };
        }
      };

      if (definitelyOffline()) return saveOnPhone();

      const media: MediaItem[] = [];
      for (const p of photos) {
        if (!p.path) {
          let r;
          try {
            r = await uploadImage({ id: p.id, blob: p.blob, takenAt: p.takenAt });
          } catch {
            return saveOnPhone();
          }
          if (!r.ok) {
            if (r.retryable) return saveOnPhone();
            return { ok: false, error: r.error };
          }
          p.path = r.path; // kept on the photo object: a retry won't upload it again
        }
        media.push(toMedia(p as PendingPhoto & { path: string }));
      }

      let r: LogResult;
      try {
        r = await logTouch({ ...input, idempotencyKey: k, media: media.length ? media : undefined });
      } catch {
        return saveOnPhone(); // the request never got an answer: queue with the same key
      }
      if (!r.ok && r.retryable) return saveOnPhone();
      if (r.ok) key.current = null;
      return r;
    },
    [queue],
  );
}
