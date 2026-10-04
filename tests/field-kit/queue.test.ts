import { describe, expect, it } from "vitest";
import { byTapOrder, createReplayer, memoryStore, nextSeq, replayQueue } from "@/lib/offline/queue";
import type { QueuedLog, QueuedPhoto, SendResult, UploadResult } from "@/lib/offline/types";
import type { MediaItem } from "@/lib/storage/paths";

const U = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

let n = 0;
function item(over: Partial<QueuedLog> = {}): QueuedLog {
  n++;
  return {
    key: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    userId: U,
    tenantId: T,
    createdAt: new Date(Date.UTC(2026, 9, 5, 15, n)).toISOString(),
    seq: n,
    input: { accountId: "acct", channel: "site_visit", outcome: "met_in_person" },
    photos: [],
    label: `log ${n}`,
    href: null,
    status: "pending",
    attempts: 0,
    ...over,
  };
}
const photo = (id: string): QueuedPhoto => ({ id, bytes: new ArrayBuffer(8), type: "image/jpeg", width: 1600, height: 1200, takenAt: "2026-10-05T15:00:00.000Z" });

/**
 * A fake server with the real semantics that matter: the touch table's unique (tenant, source, external_id)
 * index — a repeat key returns the existing touch as success. `dropResponses` simulates "the server logged it but
 * the answer never reached the phone".
 */
function fakeServer(opts: { dropResponses?: number; offlineAfter?: number; reject?: (i: QueuedLog) => string | null } = {}) {
  const touches = new Map<string, { key: string; media: MediaItem[]; order: number }>();
  const calls: string[] = [];
  let drops = opts.dropResponses ?? 0;
  let budget = opts.offlineAfter ?? Infinity;
  const uploads: string[] = [];
  const send = async (i: QueuedLog, media: MediaItem[]): Promise<SendResult> => {
    if (budget-- <= 0) throw new TypeError("Failed to fetch");
    calls.push(i.key);
    const why = opts.reject?.(i);
    if (why) return { ok: false, retryable: false, error: why };
    if (!touches.has(i.key)) touches.set(i.key, { key: i.key, media, order: touches.size }); // idempotent insert
    if (drops > 0) {
      drops--;
      throw new TypeError("Load failed"); // logged server-side, response lost
    }
    return { ok: true };
  };
  const upload = async (_i: QueuedLog, p: QueuedPhoto): Promise<UploadResult> => {
    uploads.push(p.id);
    return { ok: true, path: `${T}/2026/10/${p.id}.jpg` };
  };
  return { touches, calls, uploads, send, upload };
}

describe("offline queue — ordering", () => {
  it("replays in tap order (seq, then time), whatever order the store returns", async () => {
    const a = item({ seq: 30 });
    const b = item({ seq: 10 });
    const c = item({ seq: 20 });
    const store = memoryStore([a, b, c]);
    const srv = fakeServer();
    const r = await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(r).toEqual({ sent: 3, failed: 0, remaining: 0, stoppedOnNetwork: false });
    expect(srv.calls).toEqual([b.key, c.key, a.key]);
    expect(store.items.size).toBe(0);
    expect([a, b, c].sort(byTapOrder).map((x) => x.seq)).toEqual([10, 20, 30]);
  });

  it("stops at the first network failure and keeps the rest queued, in order", async () => {
    const xs = [item(), item(), item()];
    const store = memoryStore(xs);
    const srv = fakeServer({ offlineAfter: 1 });
    const r = await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(r.sent).toBe(1);
    expect(r.stoppedOnNetwork).toBe(true);
    expect(r.remaining).toBe(2);
    const left = (await store.list()).sort(byTapOrder);
    expect(left.map((i) => i.key)).toEqual([xs[1].key, xs[2].key]);
    expect(left[0].status).toBe("pending");
    expect(left[0].attempts).toBe(1);
  });

  it("only replays the signed-in user's items (shared phone)", async () => {
    const mine = item();
    const theirs = item({ userId: "33333333-3333-4333-8333-333333333333" });
    const store = memoryStore([mine, theirs]);
    const srv = fakeServer();
    await replayQueue({ store, send: srv.send, upload: srv.upload, filter: (i) => i.userId === U });
    expect(srv.calls).toEqual([mine.key]);
    expect((await store.list()).map((i) => i.key)).toEqual([theirs.key]);
  });

  it("nextSeq is monotonic across reloads", () => {
    expect(nextSeq([], 1000)).toBe(1000);
    expect(nextSeq([item({ seq: 5000 })], 1000)).toBe(5001);
  });
});

describe("offline queue — idempotent replay", () => {
  it("a replay after a partial success (server logged it, answer lost) never duplicates", async () => {
    const it1 = item();
    const store = memoryStore([it1]);
    const srv = fakeServer({ dropResponses: 1 });
    const first = await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(first.stoppedOnNetwork).toBe(true);
    expect(store.items.size).toBe(1); // still queued: the phone never heard back
    expect(srv.touches.size).toBe(1); // …but the server has it
    const second = await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(second.sent).toBe(1);
    expect(srv.calls).toEqual([it1.key, it1.key]); // same idempotency key both times
    expect(srv.touches.size).toBe(1); // exactly one touch
    expect(store.items.size).toBe(0);
  });

  it("two replays racing (online + visibilitychange) send each log once", async () => {
    const xs = [item(), item()];
    const store = memoryStore(xs);
    const srv = fakeServer();
    const r = createReplayer(() => replayQueue({ store, send: srv.send, upload: srv.upload }));
    const [a, b] = await Promise.all([r.run(), r.run()]);
    expect(a).toBe(b);
    expect(srv.calls).toEqual(xs.map((x) => x.key));
    expect(srv.touches.size).toBe(2);
  });

  it("uploads each photo once, carries them in media, and doesn't re-upload after a dropped log", async () => {
    const it1 = item({ photos: [photo("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), photo("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")] });
    const store = memoryStore([it1]);
    const srv = fakeServer({ dropResponses: 1 });
    await replayQueue({ store, send: srv.send, upload: srv.upload });
    const saved = (await store.list())[0];
    expect(saved.photos.every((p) => !!p.path)).toBe(true); // paths persisted before the log was sent
    await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(srv.uploads).toHaveLength(2);
    const t = [...srv.touches.values()][0];
    expect(t.media.map((m) => m.id)).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
    expect(t.media[0]).toMatchObject({ kind: "photo", path: `${T}/2026/10/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg` });
  });
});

describe("offline queue — validation failures", () => {
  it("marks a rejected log failed (with the reason) and carries on with the next", async () => {
    const bad = item();
    const good = item();
    const store = memoryStore([bad, good]);
    const srv = fakeServer({ reject: (i) => (i.key === bad.key ? "Pick a contact or an account first." : null) });
    const r = await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(r).toMatchObject({ sent: 1, failed: 1, stoppedOnNetwork: false });
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ key: bad.key, status: "failed", error: "Pick a contact or an account first." });
    // Failed items are not retried automatically.
    await replayQueue({ store, send: srv.send, upload: srv.upload });
    expect(srv.calls.filter((k) => k === bad.key)).toHaveLength(1);
  });

  it("a non-retryable upload failure fails that item; a retryable one stops the run", async () => {
    const a = item({ photos: [photo("cccccccc-cccc-4ccc-8ccc-cccccccccccc")] });
    const b = item();
    const store = memoryStore([a, b]);
    const sends: string[] = [];
    await replayQueue({
      store,
      upload: async () => ({ ok: false, retryable: false, error: "Photos must be JPEG." }),
      send: async (i) => {
        sends.push(i.key);
        return { ok: true };
      },
    });
    expect(sends).toEqual([b.key]);
    expect((await store.list())[0]).toMatchObject({ key: a.key, status: "failed", error: "A photo couldn't upload: Photos must be JPEG." });

    const c = item({ photos: [photo("dddddddd-dddd-4ddd-8ddd-dddddddddddd")] });
    const store2 = memoryStore([c, item()]);
    const r = await replayQueue({ store: store2, upload: async () => ({ ok: false, retryable: true, error: "502" }), send: async () => ({ ok: true }) });
    expect(r).toMatchObject({ sent: 0, stoppedOnNetwork: true, remaining: 2 });
  });

  it("a retryable server answer (DB unreachable) stops without failing the item", async () => {
    const a = item();
    const store = memoryStore([a]);
    const r = await replayQueue({ store, upload: async () => ({ ok: true, path: "x" }), send: async () => ({ ok: false, retryable: true, error: "Couldn't log that." }) });
    expect(r.stoppedOnNetwork).toBe(true);
    expect((await store.list())[0].status).toBe("pending");
  });
});
