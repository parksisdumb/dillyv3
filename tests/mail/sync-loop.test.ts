// The sync loop against a fake Gmail + Google OAuth HTTP server: first sync (backfill → history), 401 → refresh,
// the 500-message cap with resume, an expired history cursor, rate limits and invalid_grant.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GoogleMailClient } from "@/lib/mail/google";
import { syncConnection, type ConnectionRow, type MailStore, type SyncState } from "@/lib/mail/sync";
import type { TouchRow } from "@/lib/mail/classify";

const ME = "colby@foxroofing.co";
const NOW = Date.parse("2026-10-04T15:00:00Z");
const DAY = 86_400_000;

type FakeMsg = { id: string; at: number; labels: string[]; headers: Record<string, string> };

// ---- fake server -------------------------------------------------------------------------------------------
const fake = {
  validToken: "at-1",
  refreshCount: 0,
  revoked: false,
  rateLimitMetadata: false,
  historyExpired: false,
  profileHistoryId: "1000",
  /** Newest first, like Gmail. */
  mailbox: [] as FakeMsg[],
  /** history pages after the cursor */
  history: [] as { ids: string[] }[],
  historyId: "1005",
  pageSize: 2,
  requests: [] as string[],
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let s = "";
  for await (const c of req) s += c;
  return s;
}

const server: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  fake.requests.push(`${req.method} ${url.pathname}${url.search}`);
  if (url.pathname === "/token") {
    const p = new URLSearchParams(await readBody(req));
    if (fake.revoked || p.get("refresh_token") !== "rt-good") return send(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    fake.refreshCount++;
    fake.validToken = `at-${fake.refreshCount + 1}`;
    return send(res, 200, { access_token: fake.validToken, expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.metadata" });
  }
  if (req.headers.authorization !== `Bearer ${fake.validToken}`) return send(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
  const path = url.pathname.replace(/^\/gmail/, "");
  if (path === "/profile") return send(res, 200, { emailAddress: ME, historyId: fake.profileHistoryId });
  if (path === "/messages") {
    const start = Number(url.searchParams.get("pageToken") ?? 0);
    const page = fake.mailbox.slice(start, start + fake.pageSize);
    const next = start + fake.pageSize < fake.mailbox.length ? String(start + fake.pageSize) : undefined;
    return send(res, 200, { messages: page.map((m) => ({ id: m.id, threadId: m.id })), ...(next ? { nextPageToken: next } : {}) });
  }
  if (path.startsWith("/messages/")) {
    if (fake.rateLimitMetadata) return send(res, 429, { error: { code: 429, message: "Too many", errors: [{ reason: "rateLimitExceeded" }] } });
    const m = fake.mailbox.find((x) => x.id === decodeURIComponent(path.slice("/messages/".length)));
    if (!m) return send(res, 404, { error: { code: 404 } });
    return send(res, 200, {
      id: m.id,
      threadId: m.id,
      labelIds: m.labels,
      internalDate: String(m.at),
      payload: { headers: Object.entries(m.headers).map(([name, value]) => ({ name, value })) },
    });
  }
  if (path === "/history") {
    // Expired = older than the mailbox's current cursor (a fresh profile historyId is always valid).
    if (fake.historyExpired && Number(url.searchParams.get("startHistoryId")) < Number(fake.profileHistoryId)) return send(res, 404, { error: { code: 404, message: "Requested entity was not found." } });
    const i = Number(url.searchParams.get("pageToken") ?? 0);
    const page = fake.history[i];
    const next = i + 1 < fake.history.length ? String(i + 1) : undefined;
    return send(res, 200, {
      history: page ? [{ id: "h", messagesAdded: page.ids.map((id) => ({ message: { id } })) }] : [],
      historyId: fake.historyId,
      ...(next ? { nextPageToken: next } : {}),
    });
  }
  send(res, 404, {});
});

let base = "";
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// ---- in-memory store ----------------------------------------------------------------------------------------
const CONTACTS = [
  { id: "c-pm", email: "pm@acme.com" },
  { id: "c-owner", email: "Owner@Acme.com" },
];

function memStore() {
  const touches = new Map<string, TouchRow>();
  const saved: Parameters<MailStore["saveProgress"]>[1][] = [];
  const store: MailStore = {
    memberEmails: async () => [ME, "tyler@foxroofing.co"],
    contactsByEmail: async (_t, emails) => CONTACTS.filter((c) => emails.includes(c.email.toLowerCase())),
    ingest: async (_t, _u, source, rows) => {
      expect(source).toBe("gmail");
      let inserted = 0;
      for (const r of rows) {
        if (touches.has(r.external_id)) continue;
        touches.set(r.external_id, r);
        inserted++;
      }
      return { inserted, duplicates: rows.length - inserted };
    },
    saveProgress: async (_id, patch) => {
      saved.push(patch);
    },
  };
  return { store, touches, saved, last: () => Object.assign({}, ...saved) as Record<string, unknown> };
}

function client(tokens: { accessToken: string | null; refreshToken: string }, onTokens?: (t: { accessToken: string }) => void) {
  return new GoogleMailClient({
    clientId: "cid",
    clientSecret: "secret",
    tokens: { ...tokens, expiresAt: NOW + 3_600_000 + Date.now() },
    endpoints: { token: `${base}/token`, gmail: `${base}/gmail` },
    onTokens,
    concurrency: 10,
  });
}

const conn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "conn-1",
  tenant_id: "t-fox",
  user_id: "u-colby",
  provider: "google",
  email: ME,
  history_id: null,
  sync_state: null,
  last_synced_at: null,
  ...over,
});

const m = (id: string, daysAgo: number, headers: Record<string, string>, labels = ["INBOX"]): FakeMsg => ({ id, at: NOW - daysAgo * DAY, labels, headers });

beforeEach(() => {
  Object.assign(fake, {
    validToken: "at-1",
    refreshCount: 0,
    revoked: false,
    rateLimitMetadata: false,
    historyExpired: false,
    profileHistoryId: "1000",
    historyId: "1005",
    pageSize: 2,
    requests: [],
    history: [],
    mailbox: [
      m("m1", 1, { From: "Pat <pm@acme.com>", To: ME, Subject: "Re: Roof bid" }),
      m("m2", 2, { From: ME, To: "pm@acme.com, owner@acme.com", Subject: "Roof bid" }, ["SENT"]),
      m("m3", 3, { From: "stranger@nowhere.com", To: ME, Subject: "Cold pitch" }),
      m("m4", 10, { From: "owner@acme.com", To: ME, Subject: "Automatic reply: away", "Auto-Submitted": "auto-replied" }),
      m("m5", 45, { From: "pm@acme.com", To: ME, Subject: "Too old" }),
      m("m6", 50, { From: "pm@acme.com", To: ME, Subject: "Older still" }),
    ],
  });
});

describe("Gmail sync loop (fake server)", () => {
  it("first sync: refreshes on 401, backfills 30 days newest-first, then follows history from the start cursor", async () => {
    fake.history = [{ ids: ["m7"] }];
    fake.mailbox.unshift(m("m7", 0, { From: "owner@acme.com", To: ME, Subject: "New during backfill" }));
    const s = memStore();
    const refreshed: string[] = [];
    const res = await syncConnection(conn(), {
      client: client({ accessToken: "stale-token", refreshToken: "rt-good" }, (t) => refreshed.push(t.accessToken)),
      store: s.store,
      now: () => NOW,
    });
    expect(res.ok).toBe(true);
    expect(fake.refreshCount).toBe(1);
    expect(refreshed).toEqual(["at-2"]);
    // m1..m4 + m7 in window; m5/m6 older than 30 days; m3 unknown sender not stored.
    expect([...s.touches.keys()].sort()).toEqual(["m1", "m2:c-owner", "m2:c-pm", "m4", "m7"]);
    expect(s.touches.get("m1")).toMatchObject({ direction: "inbound", outcome: "replied", notes: "Re: Roof bid", contact_id: "c-pm" });
    expect(s.touches.get("m4")).toMatchObject({ outcome: "auto_reply", skip_follow_up: true });
    expect(res.ok && res.stats).toMatchObject({ unknownSenders: 1, more: false, logged: 5, duplicates: 1 });
    // Cursor: the profile historyId captured at backfill start, then advanced by the history call.
    expect(s.last()).toMatchObject({ history_id: "1005", sync_state: null, status: "active", last_error: null });
    // Metadata only: format=metadata + a fields mask; no search query (gmail.metadata forbids q); never format=full.
    const metas = fake.requests.filter((r) => r.startsWith("GET /gmail/messages/"));
    expect(metas.length).toBeGreaterThan(0);
    for (const r of metas) {
      expect(r).toContain("format=metadata");
      expect(r).toContain("fields=");
      expect(r).not.toMatch(/format=(full|raw)/);
    }
    expect(fake.requests.some((r) => r.includes("q="))).toBe(false);
    expect(fake.requests.some((r) => r.startsWith("GET /gmail/history?startHistoryId=1000"))).toBe(true);
  });

  it("stops at the message cap, saves its place, and the next run resumes to completion", async () => {
    const s = memStore();
    const r1 = await syncConnection(conn(), { client: client({ accessToken: "at-1", refreshToken: "rt-good" }), store: s.store, now: () => NOW, cap: 2 });
    expect(r1.ok && r1.stats).toMatchObject({ more: true, stoppedBy: "cap", fetched: 2 });
    const st = s.last().sync_state as SyncState;
    expect(st).toMatchObject({ phase: "backfill", pendingCursor: "1000", pageToken: "2" });
    expect(s.last().history_id).toBeNull();

    const r2 = await syncConnection(conn({ sync_state: st }), { client: client({ accessToken: "at-1", refreshToken: "rt-good" }), store: s.store, now: () => NOW, cap: 10 });
    expect(r2.ok && r2.stats.fetched).toBe(4); // pages 2 and 3 (cutoff reached on page 3)
    expect(s.last()).toMatchObject({ history_id: "1005", sync_state: null });
    expect([...s.touches.keys()].sort()).toEqual(["m1", "m2:c-owner", "m2:c-pm", "m4"]);
  });

  it("history: only new messages; an expired cursor falls back to a re-list since the last sync", async () => {
    const s = memStore();
    fake.history = [{ ids: ["m1"] }, { ids: ["m2"] }];
    const r = await syncConnection(conn({ history_id: "900", last_synced_at: new Date(NOW - 4 * DAY).toISOString() }), {
      client: client({ accessToken: "at-1", refreshToken: "rt-good" }),
      store: s.store,
      now: () => NOW,
    });
    expect(r.ok && r.stats).toMatchObject({ phase: "history", fetched: 2 });
    expect([...s.touches.keys()].sort()).toEqual(["m1", "m2:c-owner", "m2:c-pm"]);

    fake.historyExpired = true;
    const s2 = memStore();
    const r2 = await syncConnection(conn({ history_id: "1", last_synced_at: new Date(NOW - 4 * DAY).toISOString() }), {
      client: client({ accessToken: "at-1", refreshToken: "rt-good" }),
      store: s2.store,
      now: () => NOW,
    });
    // Re-listed back to last sync − 1 day (5 days): m1, m2 (m3 unknown); m4 (10 days) is outside.
    expect(r2.ok).toBe(true);
    expect([...s2.touches.keys()].sort()).toEqual(["m1", "m2:c-owner", "m2:c-pm"]);
    expect(s2.last()).toMatchObject({ history_id: "1005", sync_state: null });
    expect(fake.requests.filter((r) => r.startsWith("GET /gmail/profile"))).toHaveLength(1);
  });

  it("a rate limit ends the run quietly and keeps the cursor", async () => {
    fake.rateLimitMetadata = true;
    fake.history = [{ ids: ["m1"] }];
    const s = memStore();
    const r = await syncConnection(conn({ history_id: "900" }), { client: client({ accessToken: "at-1", refreshToken: "rt-good" }), store: s.store, now: () => NOW });
    expect(r.ok && r.stats).toMatchObject({ more: true, stoppedBy: "rate_limit" });
    expect(s.last().history_id).toBe("900");
  });

  it("invalid_grant marks the connection for reconnect with a human message", async () => {
    fake.revoked = true;
    const s = memStore();
    const r = await syncConnection(conn({ history_id: "900" }), { client: client({ accessToken: "stale", refreshToken: "rt-good" }), store: s.store, now: () => NOW });
    expect(r).toMatchObject({ ok: false, revoked: true });
    expect(s.last()).toMatchObject({ status: "error", last_error: "Reconnect Gmail — Google access was removed", history_id: "900" });
    expect(s.touches.size).toBe(0);
  });
});
