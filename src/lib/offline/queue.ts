// Offline log queue — the replay engine (pure: storage, network and clock are injected; unit-tested).
//
// Rules:
//  * In order: oldest tap first (seq, then createdAt).
//  * Photos first, then the log. Each uploaded photo's path is saved before the next step, so a replay after a
//    dropped connection never re-uploads (and re-uploading would just overwrite the same key anyway).
//  * The log is sent with its original idempotency key. The server treats a duplicate key as success (the unique
//    index on touch(tenant_id, source, external_id)), so "sent but the answer never came back" replays safely.
//  * A network failure (thrown, or a retryable server answer) stops the run: everything stays queued, in order.
//  * A validation failure (4xx-style, not retryable) marks that item failed for the rep to fix or discard, and the
//    run continues with the next one.
import type { MediaItem } from "@/lib/storage/paths";
import type { QueuedLog, QueuedPhoto, QueueStore, SendResult, UploadResult } from "@/lib/offline/types";

export type ReplayDeps = {
  store: QueueStore;
  upload: (item: QueuedLog, photo: QueuedPhoto) => Promise<UploadResult>;
  send: (item: QueuedLog, media: MediaItem[]) => Promise<SendResult>;
  /** Only replay these (e.g. the signed-in user's items on a shared phone). */
  filter?: (item: QueuedLog) => boolean;
  now?: () => Date;
};

export type ReplaySummary = { sent: number; failed: number; remaining: number; stoppedOnNetwork: boolean };

export function byTapOrder(a: QueuedLog, b: QueuedLog): number {
  return a.seq - b.seq || a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key);
}

export function mediaFor(item: QueuedLog): MediaItem[] {
  return item.photos
    .filter((p): p is QueuedPhoto & { path: string } => !!p.path)
    .map((p) => ({
      kind: "photo" as const,
      id: p.id,
      path: p.path,
      width: p.width,
      height: p.height,
      taken_at: p.takenAt,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      caption: p.caption ?? null,
    }));
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function replayQueue(deps: ReplayDeps): Promise<ReplaySummary> {
  const now = deps.now ?? (() => new Date());
  const all = (await deps.store.list()).filter((i) => i.status === "pending" && (!deps.filter || deps.filter(i))).sort(byTapOrder);
  let sent = 0;
  let failed = 0;
  for (let n = 0; n < all.length; n++) {
    const item: QueuedLog = { ...all[n], attempts: all[n].attempts + 1, lastTriedAt: now().toISOString() };
    const stop = async (error: string) => {
      await deps.store.put({ ...item, error });
      return { sent, failed, remaining: all.length - n, stoppedOnNetwork: true };
    };
    const fail = async (error: string) => {
      await deps.store.put({ ...item, status: "failed", error });
      failed++;
    };

    // 1) Photos.
    let photoFailed = false;
    for (let i = 0; i < item.photos.length; i++) {
      if (item.photos[i].path) continue;
      let r: UploadResult;
      try {
        r = await deps.upload(item, item.photos[i]);
      } catch (e) {
        return stop(errText(e));
      }
      if (!r.ok) {
        if (r.retryable) return stop(r.error);
        await fail(`A photo couldn't upload: ${r.error}`);
        photoFailed = true;
        break;
      }
      item.photos = item.photos.map((p, j) => (j === i ? { ...p, path: r.path } : p));
      await deps.store.put(item);
    }
    if (photoFailed) continue;

    // 2) The log, same idempotency key as the first attempt.
    let res: SendResult;
    try {
      res = await deps.send(item, mediaFor(item));
    } catch (e) {
      return stop(errText(e));
    }
    if (res.ok) {
      await deps.store.remove(item.key);
      sent++;
    } else if (res.retryable) {
      return stop(res.error);
    } else {
      await fail(res.error);
    }
  }
  return { sent, failed, remaining: 0, stoppedOnNetwork: false };
}

/**
 * Single-flight wrapper: `online`, `visibilitychange` and app-open can all fire together; only one replay runs at a
 * time, and a trigger that arrives mid-run schedules exactly one follow-up run (for items queued meanwhile).
 */
export function createReplayer(run: () => Promise<ReplaySummary>) {
  let current: Promise<ReplaySummary> | null = null;
  let again = false;
  const kick = (): Promise<ReplaySummary> => {
    if (current) {
      again = true;
      return current;
    }
    current = (async () => {
      try {
        let total = await run();
        while (again && !total.stoppedOnNetwork) {
          again = false;
          const next = await run();
          total = { sent: total.sent + next.sent, failed: total.failed + next.failed, remaining: next.remaining, stoppedOnNetwork: next.stoppedOnNetwork };
        }
        return total;
      } finally {
        again = false;
        current = null;
      }
    })();
    return current;
  };
  return { run: kick, get running() {
    return current !== null;
  } };
}

/** In-memory store: tests, and the fallback when IndexedDB is unavailable (private mode on old Safari). */
export function memoryStore(initial: QueuedLog[] = []): QueueStore & { items: Map<string, QueuedLog> } {
  const items = new Map(initial.map((i) => [i.key, structuredCloneSafe(i)]));
  return {
    items,
    async list() {
      return [...items.values()].map(structuredCloneSafe);
    },
    async put(item) {
      items.set(item.key, structuredCloneSafe(item));
    },
    async remove(key) {
      items.delete(key);
    },
  };
}

function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : v;
}

/** The per-device sequence: max(seq)+1 over what's queued, never below the clock (survives reloads). */
export function nextSeq(items: QueuedLog[], nowMs: number): number {
  return Math.max(nowMs, ...items.map((i) => i.seq + 1));
}
