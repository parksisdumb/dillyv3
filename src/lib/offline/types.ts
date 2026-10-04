// Offline log queue — shared types (pure; no browser APIs).
import type { LogInput } from "@/lib/actions/log-types";

/** A photo waiting to go up with its log. `path` is set once its upload succeeded (so a replay never re-uploads). */
export type QueuedPhoto = {
  id: string; // uuid — also the storage file name, so a repeated upload overwrites itself
  bytes: ArrayBuffer; // stored as bytes (not Blob): older iOS Safari can't keep Blobs in IndexedDB
  type: string;
  width: number;
  height: number;
  takenAt: string;
  lat?: number | null;
  lng?: number | null;
  caption?: string | null;
  path?: string | null;
};

export type QueuedLog = {
  /** The log's idempotency key: the same key on every attempt, so a replay after a partial success logs once. */
  key: string;
  userId: string;
  tenantId: string;
  /** When the rep tapped the outcome (becomes touch.occurred_at). */
  createdAt: string;
  /** Monotonic per device: replays go in tap order. */
  seq: number;
  input: Omit<LogInput, "idempotencyKey" | "media" | "occurredAt" | "tenantId">;
  photos: QueuedPhoto[];
  /** "Site visit · Greystar Riverside" — what the rep sees in the queue sheet. */
  label: string;
  /** Where to go to fix it (the account/contact/property page). */
  href: string | null;
  status: "pending" | "failed";
  error?: string | null;
  attempts: number;
  lastTriedAt?: string | null;
};

export interface QueueStore {
  list(): Promise<QueuedLog[]>;
  put(item: QueuedLog): Promise<void>;
  remove(key: string): Promise<void>;
}

export type SendResult = { ok: true } | { ok: false; retryable: boolean; error: string };
export type UploadResult = { ok: true; path: string } | { ok: false; retryable: boolean; error: string };
