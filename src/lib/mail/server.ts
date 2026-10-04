import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDb } from "@/agents/runtime/db";
import { log } from "@/lib/observability/log";
import type { ContactMatch, TouchRow } from "./classify";
import { googleMailConfig, type GoogleMailConfig } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { GoogleMailClient, revokeGoogleToken } from "./google";
import type { MailProviderId } from "./provider";
import { syncConnection, type ConnectionRow, type IngestResult, type MailStore, type SyncOutcome, type SyncState } from "./sync";

/**
 * Server-side mail plumbing: the DB-backed MailStore, token encryption at the edges, and the entry points used by
 * the OAuth callback, the Inngest functions and the Settings actions. Service role only — tokens never leave the
 * server, and nothing here is imported by client components.
 *
 * mail_connection / mail_ingest aren't in the generated Database types yet (`npm run db:types` after deploy), so
 * this module talks to them through an untyped client.
 */
type Untyped = SupabaseClient;
async function db(): Promise<Untyped> {
  return (await adminDb()) as unknown as Untyped;
}

/** AAD binding a token ciphertext to its (tenant, user, provider). */
export const tokenAad = (tenantId: string, userId: string, provider: MailProviderId) => `${tenantId}:${userId}:${provider}`;

type FullConnection = ConnectionRow & {
  status: "active" | "revoked" | "error";
  refresh_token_encrypted: string | null;
  access_token_encrypted: string | null;
  access_expires_at: string | null;
};

const COLS = "id,tenant_id,user_id,provider,email,history_id,sync_state,last_synced_at,status,refresh_token_encrypted,access_token_encrypted,access_expires_at";

export async function loadConnection(id: string): Promise<FullConnection | null> {
  const { data, error } = await (await db()).from("mail_connection").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`load mail connection: ${error.message}`);
  return (data as FullConnection | null) ?? null;
}

export async function activeConnections(): Promise<{ id: string; tenant_id: string }[]> {
  const { data, error } = await (await db()).from("mail_connection").select("id,tenant_id").eq("status", "active");
  if (error) throw new Error(`list mail connections: ${error.message}`);
  return (data ?? []) as { id: string; tenant_id: string }[];
}

export function dbStore(sb: Untyped): MailStore {
  return {
    async memberEmails(tenantId) {
      const { data: ms, error } = await sb.from("membership").select("user_id").eq("tenant_id", tenantId).eq("active", true);
      if (error) throw new Error(`members: ${error.message}`);
      const ids = (ms ?? []).map((m: { user_id: string }) => m.user_id);
      if (!ids.length) return [];
      const { data: ps, error: pe } = await sb.from("profile").select("email").in("id", ids);
      if (pe) throw new Error(`member emails: ${pe.message}`);
      return (ps ?? []).map((p: { email: string | null }) => p.email ?? "").filter(Boolean);
    },
    async contactsByEmail(tenantId, emails) {
      const out: ContactMatch[] = [];
      for (let i = 0; i < emails.length; i += 100) {
        const { data, error } = await sb
          .from("contact")
          .select("id,email")
          .eq("tenant_id", tenantId)
          .in("email", emails.slice(i, i + 100))
          .is("duplicate_of", null)
          .eq("is_test", false);
        if (error) throw new Error(`match contacts: ${error.message}`);
        out.push(...((data ?? []) as ContactMatch[]));
      }
      return out;
    },
    async ingest(tenantId, userId, source, rows: TouchRow[]) {
      const { data, error } = await sb.rpc("mail_ingest", { p_tenant: tenantId, p_user: userId, p_source: source, p_rows: rows });
      if (error) throw new Error(`mail_ingest: ${error.message}`);
      return data as IngestResult;
    },
    async saveProgress(connectionId, patch) {
      const { error } = await sb.from("mail_connection").update(patch).eq("id", connectionId);
      if (error) throw new Error(`save mail progress: ${error.message}`);
    },
  };
}

function googleClientFor(c: FullConnection, cfg: GoogleMailConfig, sb: Untyped): GoogleMailClient {
  if (!c.refresh_token_encrypted) throw new Error("connection has no refresh token");
  const aad = tokenAad(c.tenant_id, c.user_id, c.provider);
  let accessToken: string | null = null;
  try {
    accessToken = c.access_token_encrypted ? decryptSecret(c.access_token_encrypted, cfg.tokenKey, aad) : null;
  } catch {
    accessToken = null; // a stale/rotated key just means one extra refresh
  }
  return new GoogleMailClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    tokens: {
      accessToken,
      expiresAt: c.access_expires_at ? Date.parse(c.access_expires_at) : null,
      refreshToken: decryptSecret(c.refresh_token_encrypted, cfg.tokenKey, aad),
    },
    onTokens: async (t) => {
      const patch: Record<string, unknown> = {
        access_token_encrypted: encryptSecret(t.accessToken, cfg.tokenKey, aad),
        access_expires_at: new Date(t.expiresAt).toISOString(),
      };
      if (t.refreshToken) patch.refresh_token_encrypted = encryptSecret(t.refreshToken, cfg.tokenKey, aad);
      const { error } = await sb.from("mail_connection").update(patch).eq("id", c.id);
      if (error) log.warn("mail:save-tokens-failed", { tenant: c.tenant_id, user: c.user_id, connection: c.id, err: error });
    },
  });
}

/** Sync one connection now. Never throws for a mailbox problem; returns null when there's nothing to do. */
export async function runMailSync(connectionId: string, opts: { cap?: number } = {}): Promise<SyncOutcome | null> {
  const started = Date.now();
  const c = await loadConnection(connectionId);
  if (!c || c.status !== "active") return null;
  if (c.provider !== "google") return null; // Outlook: coming soon
  const cfg = googleMailConfig();
  if (!cfg) {
    log.warn("mail:sync-not-configured", { tenant: c.tenant_id, connection: c.id });
    return null;
  }
  const sb = await db();
  const res = await syncConnection(c, { client: googleClientFor(c, cfg, sb), store: dbStore(sb), cap: opts.cap });
  const fields = { tenant: c.tenant_id, user: c.user_id, connection: c.id, durationMs: Date.now() - started, ...res.stats };
  if (res.ok) log.info("mail:sync", fields);
  else if (res.revoked) log.warn("mail:sync-revoked", fields);
  else log.error("mail:sync-failed", { ...fields, err: new Error(res.error) });
  return res;
}

/** Store a freshly granted Google connection (OAuth callback). Resets the cursor so the 30-day backfill runs. */
export async function saveGoogleConnection(input: {
  tenantId: string;
  userId: string;
  email: string;
  scopes: string[];
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  key: Buffer;
}): Promise<string> {
  const aad = tokenAad(input.tenantId, input.userId, "google");
  const row = {
    tenant_id: input.tenantId,
    user_id: input.userId,
    provider: "google",
    email: input.email.toLowerCase(),
    scopes: input.scopes,
    refresh_token_encrypted: encryptSecret(input.refreshToken, input.key, aad),
    access_token_encrypted: encryptSecret(input.accessToken, input.key, aad),
    access_expires_at: new Date(input.expiresAt).toISOString(),
    history_id: null,
    sync_state: null as SyncState | null,
    status: "active",
    last_error: null,
  };
  const { data, error } = await (await db())
    .from("mail_connection")
    .upsert(row, { onConflict: "tenant_id,user_id,provider" })
    .select("id")
    .single();
  if (error) throw new Error(`save mail connection: ${error.message}`);
  return (data as { id: string }).id;
}

/** The signed-in user's connection id in a tenant (service role; never returns secrets). */
export async function myConnectionId(tenantId: string, userId: string, provider: MailProviderId = "google"): Promise<string | null> {
  const { data } = await (await db()).from("mail_connection").select("id").eq("tenant_id", tenantId).eq("user_id", userId).eq("provider", provider).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Revoke at Google (best effort), wipe the tokens, mark revoked. Touches already logged stay. */
export async function disconnectConnection(connectionId: string): Promise<void> {
  const c = await loadConnection(connectionId);
  if (!c) return;
  const cfg = googleMailConfig();
  if (cfg && c.provider === "google" && c.refresh_token_encrypted) {
    try {
      const token = decryptSecret(c.refresh_token_encrypted, cfg.tokenKey, tokenAad(c.tenant_id, c.user_id, c.provider));
      if (!(await revokeGoogleToken(token))) log.warn("mail:revoke-failed", { tenant: c.tenant_id, connection: c.id });
    } catch (err) {
      log.warn("mail:revoke-failed", { tenant: c.tenant_id, connection: c.id, err });
    }
  }
  const { error } = await (await db())
    .from("mail_connection")
    .update({ status: "revoked", refresh_token_encrypted: null, access_token_encrypted: null, access_expires_at: null, sync_state: null, last_error: null })
    .eq("id", connectionId);
  if (error) throw new Error(`disconnect: ${error.message}`);
}
