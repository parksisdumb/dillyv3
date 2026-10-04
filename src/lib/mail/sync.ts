/**
 * One sync run for one mailbox connection. Provider-neutral (MailClient) and storage-neutral (MailStore), so the
 * loop is tested against a fake Gmail HTTP server and an in-memory store (tests/mail/sync-loop.test.ts).
 *
 * First sync: page through recent mail (newest first) back 30 days, then switch to the change feed from the
 * cursor captured when the backfill started (so nothing that arrived meanwhile is missed — duplicates are
 * idempotent). Later syncs: the change feed (Gmail history) from `historyId`; an expired cursor falls back to a
 * re-list back to the last successful sync. A run stops after ~500 message fetches and saves its place; the next
 * tick continues. Idempotent throughout: touch.external_id is unique per tenant/source.
 */
import { buildTouchRows, internalDomains, lookupAddresses, type ContactMatch, type TouchRow } from "./classify";
import { SYNC_LIMITS } from "./config";
import { MailAuthRevokedError, MailRateLimitedError, RECONNECT_MESSAGE, type MailClient, type MailMessage, type MailProviderId } from "./provider";

export type SyncState =
  | { phase: "backfill"; pendingCursor: string; cutoff: number; pageToken?: string }
  | { phase: "history"; pageToken: string };

export type ConnectionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: MailProviderId;
  email: string;
  history_id: string | null;
  sync_state: SyncState | null;
  last_synced_at: string | null;
};

export type IngestResult = { inserted: number; duplicates: number; already_in_v2?: number; invalid?: number };

export interface MailStore {
  /** Emails of the tenant's active members (their company domains are internal). */
  memberEmails(tenantId: string): Promise<string[]>;
  /** Contacts in the tenant whose email is one of `emails` (case-insensitive). */
  contactsByEmail(tenantId: string, emails: string[]): Promise<ContactMatch[]>;
  ingest(tenantId: string, userId: string, source: "gmail" | "outlook", rows: TouchRow[]): Promise<IngestResult>;
  saveProgress(connectionId: string, patch: Partial<{ history_id: string | null; sync_state: SyncState | null; last_synced_at: string; last_error: string | null; status: "active" | "error"; last_sync_stats: SyncStats }>): Promise<void>;
}

export type SyncStats = {
  fetched: number;
  logged: number;
  duplicates: number;
  alreadyInV2: number;
  unknownSenders: number;
  ignored: number;
  byKind: Record<string, number>;
  phase: "backfill" | "history";
  more: boolean;
  stoppedBy?: "cap" | "rate_limit";
};

export type SyncOutcome = { ok: true; stats: SyncStats } | { ok: false; revoked: boolean; error: string; stats: SyncStats };

const SOURCE: Record<MailProviderId, "gmail" | "outlook"> = { google: "gmail", microsoft: "outlook" };

export async function syncConnection(
  conn: ConnectionRow,
  deps: { client: MailClient; store: MailStore; now?: () => number; cap?: number },
): Promise<SyncOutcome> {
  const now = deps.now ?? Date.now;
  const cap = deps.cap ?? SYNC_LIMITS.maxMessagesPerRun;
  const { client, store } = deps;
  const stats: SyncStats = { fetched: 0, logged: 0, duplicates: 0, alreadyInV2: 0, unknownSenders: 0, ignored: 0, byKind: {}, phase: "history", more: false };
  const userEmail = conn.email.toLowerCase();
  const internal = internalDomains([userEmail, ...(await store.memberEmails(conn.tenant_id))]);
  const followUpCutoff = now() - SYNC_LIMITS.followUpWindowDays * 86_400_000;

  let historyId = conn.history_id;
  let state: SyncState | null = conn.sync_state;

  const ingest = async (msgs: MailMessage[], cutoff?: number) => {
    const inWindow = cutoff ? msgs.filter((m) => m.internalDate >= cutoff) : msgs;
    if (inWindow.length === 0) return;
    const addrs = lookupAddresses(inWindow, userEmail, internal);
    const matches = addrs.length ? await store.contactsByEmail(conn.tenant_id, addrs) : [];
    const byEmail = new Map<string, ContactMatch[]>();
    for (const c of matches) {
      const k = c.email.toLowerCase();
      byEmail.set(k, [...(byEmail.get(k) ?? []), c]);
    }
    const { rows, stats: b } = buildTouchRows(inWindow, { userEmail, internal, contactsByEmail: byEmail, followUpCutoff });
    stats.unknownSenders += b.unknown;
    stats.ignored += b.ignored;
    for (const [k, v] of Object.entries(b.byKind)) stats.byKind[k] = (stats.byKind[k] ?? 0) + v;
    if (rows.length) {
      const r = await store.ingest(conn.tenant_id, conn.user_id, SOURCE[conn.provider], rows);
      stats.logged += r.inserted;
      stats.duplicates += r.duplicates;
      stats.alreadyInV2 += r.already_in_v2 ?? 0;
    }
  };

  const save = (extra: Parameters<MailStore["saveProgress"]>[1] = {}) =>
    store.saveProgress(conn.id, { history_id: historyId, sync_state: state, last_sync_stats: stats, ...extra });

  try {
    // Start a backfill: first sync, or the change feed expired.
    const startBackfill = async (cutoff: number) => {
      const p = await client.profile();
      state = { phase: "backfill", pendingCursor: p.cursor, cutoff };
    };
    if (!historyId && state?.phase !== "backfill") await startBackfill(now() - SYNC_LIMITS.backfillDays * 86_400_000);

    let expirations = 0;
    for (;;) {
      if (state?.phase === "backfill") {
        stats.phase = "backfill";
        const bf: Extract<SyncState, { phase: "backfill" }> = state;
        const page = await client.listRecent(bf.pageToken);
        const msgs = await client.getMetadata(page.ids);
        stats.fetched += msgs.length;
        await ingest(msgs, bf.cutoff);
        const reachedCutoff = msgs.some((m) => m.internalDate > 0 && m.internalDate < bf.cutoff);
        if (reachedCutoff || !page.nextPageToken) {
          // Backfill done: the change feed takes over from where it started.
          historyId = bf.pendingCursor;
          state = null;
          continue;
        }
        state = { ...bf, pageToken: page.nextPageToken };
      } else {
        stats.phase = "history";
        const pageToken = state?.phase === "history" ? state.pageToken : undefined;
        const r = await client.changesSince(historyId!, pageToken);
        if (r === "expired") {
          if (++expirations > 1) throw new Error("change feed cursor expired twice in one run");
          const since = conn.last_synced_at ? Date.parse(conn.last_synced_at) - 86_400_000 : 0;
          await startBackfill(Math.max(since, now() - SYNC_LIMITS.backfillDays * 86_400_000));
          continue;
        }
        const msgs = await client.getMetadata(r.ids);
        stats.fetched += msgs.length;
        await ingest(msgs);
        if (!r.nextPageToken) {
          historyId = r.cursor;
          state = null;
          break;
        }
        state = { phase: "history", pageToken: r.nextPageToken };
      }
      if (stats.fetched >= cap) {
        stats.more = true;
        stats.stoppedBy = "cap";
        break;
      }
    }
    await save({ last_synced_at: new Date(now()).toISOString(), last_error: null, status: "active" });
    return { ok: true, stats };
  } catch (err) {
    if (err instanceof MailRateLimitedError) {
      // Keep the place we reached; continue next tick. Not an error for the rep.
      stats.more = true;
      stats.stoppedBy = "rate_limit";
      await save();
      return { ok: true, stats };
    }
    if (err instanceof MailAuthRevokedError) {
      await save({ status: "error", last_error: RECONNECT_MESSAGE[conn.provider] });
      return { ok: false, revoked: true, error: err.message, stats };
    }
    // Unknown failure: keep progress already made (ingest is idempotent) and let the caller log it.
    await save().catch(() => {});
    return { ok: false, revoked: false, error: err instanceof Error ? err.message : String(err), stats };
  }
}
