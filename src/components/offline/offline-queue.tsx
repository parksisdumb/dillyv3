"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logTouch } from "@/lib/actions/log";
import { deviceQueue } from "@/lib/offline/idb";
import { createReplayer, nextSeq, replayQueue } from "@/lib/offline/queue";
import { definitelyOffline } from "@/lib/offline/net";
import { uploadImage } from "@/lib/offline/upload";
import type { QueuedLog } from "@/lib/offline/types";
import { useToast } from "@/components/ui/toast";

/**
 * Offline log queue for the signed-in rep. Logs made with no signal are kept in IndexedDB (with their photos) and
 * replayed in tap order, with the original idempotency key, when the phone comes back: on the `online` event, when
 * Dilly comes back to the foreground, on app open, and every 20 s while anything is waiting. Works without the
 * service worker.
 */
export type NewQueued = Omit<QueuedLog, "seq" | "userId" | "tenantId" | "status" | "attempts" | "error" | "lastTriedAt">;

type Ctx = {
  items: QueuedLog[];
  pending: number;
  failed: QueuedLog[];
  sending: boolean;
  online: boolean;
  enqueue: (item: NewQueued) => Promise<number>;
  replayNow: () => void;
  retry: (key: string) => Promise<void>;
  discard: (key: string) => Promise<void>;
};

const QueueCtx = createContext<Ctx | null>(null);
export const useOfflineQueue = () => useContext(QueueCtx);

export const queuedLabel = (n: number) => `Waiting for signal · ${n} queued`;

export function OfflineQueueProvider({ userId, tenantId, seed, children }: { userId: string; tenantId: string; seed?: QueuedLog[]; children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<QueuedLog[]>(seed ?? []);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(!seed);
  const mine = useCallback((i: QueuedLog) => i.userId === userId, [userId]);

  const refresh = useCallback(async () => {
    try {
      const all = await deviceQueue().list();
      setItems(all.filter(mine).sort((a, b) => a.seq - b.seq));
    } catch {
      /* storage unavailable: nothing to show */
    }
  }, [mine]);

  // Stable replayer (single-flight) — rebuilt only when the user changes.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const replayer = useMemo(
    () =>
      createReplayer(() =>
        replayQueue({
          store: deviceQueue(),
          filter: (i) => i.userId === userId,
          upload: (item, p) => uploadImage({ id: p.id, blob: new Blob([p.bytes], { type: p.type || "image/jpeg" }), takenAt: p.takenAt, tenantId: item.tenantId }),
          send: async (item, media) => {
            const r = await logTouch({ ...item.input, idempotencyKey: item.key, media, occurredAt: item.createdAt, tenantId: item.tenantId });
            return r.ok ? { ok: true } : { ok: false, retryable: !!r.retryable, error: r.error };
          },
        }),
      ),
    [userId],
  );

  const replayNow = useCallback(() => {
    if (definitelyOffline() || replayer.running) return;
    void (async () => {
      const before = await deviceQueue()
        .list()
        .then((xs) => xs.filter((i) => i.userId === userId && i.status === "pending").length)
        .catch(() => 0);
      if (!before) return refresh();
      setSending(true);
      try {
        const r = await replayer.run();
        if (r.sent) {
          toastRef.current(r.sent === 1 ? "Sent your queued log" : `Sent ${r.sent} queued logs`);
          router.refresh();
        }
        if (r.failed) toastRef.current(r.failed === 1 ? "1 queued log needs a fix — tap the banner" : `${r.failed} queued logs need a fix — tap the banner`, "bad");
      } catch {
        /* stays queued */
      } finally {
        setSending(false);
        void refresh();
      }
    })();
  }, [replayer, refresh, router, userId]);

  const enqueue = useCallback(
    async (item: NewQueued) => {
      const store = deviceQueue();
      const all = await store.list();
      await store.put({ ...item, userId, tenantId, seq: nextSeq(all, Date.now()), status: "pending", attempts: 0, error: null, lastTriedAt: null });
      await refresh();
      return all.filter((i) => i.userId === userId && i.status === "pending").length + 1;
    },
    [refresh, tenantId, userId],
  );

  const retry = useCallback(
    async (key: string) => {
      const store = deviceQueue();
      const it = (await store.list()).find((i) => i.key === key);
      if (!it) return;
      // A retry re-uploads photos too (a "photo didn't finish uploading" failure clears itself).
      await store.put({ ...it, status: "pending", error: null, photos: it.photos.map((p) => ({ ...p, path: null })) });
      await refresh();
      replayNow();
    },
    [refresh, replayNow],
  );

  const discard = useCallback(
    async (key: string) => {
      await deviceQueue().remove(key);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (seed) return; // dev preview: static
    setOnline(!definitelyOffline());
    void refresh();
    const t = setTimeout(replayNow, 800); // on app open
    const onOnline = () => {
      setOnline(true);
      replayNow();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        replayNow();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed is a preview-only constant
  }, [refresh, replayNow]);

  const pending = items.filter((i) => i.status === "pending").length;
  // Weak signal reads as "online" without ever firing the event: keep trying every 20 s while something waits.
  useEffect(() => {
    if (!pending || seed) return;
    const h = setInterval(replayNow, 20_000);
    return () => clearInterval(h);
  }, [pending, replayNow, seed]);

  const value = useMemo<Ctx>(
    () => ({ items, pending, failed: items.filter((i) => i.status === "failed"), sending, online, enqueue, replayNow, retry, discard }),
    [items, pending, sending, online, enqueue, replayNow, retry, discard],
  );
  return <QueueCtx.Provider value={value}>{children}</QueueCtx.Provider>;
}
