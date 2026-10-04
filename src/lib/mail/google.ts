/**
 * Gmail over plain fetch (no googleapis dependency). Scope: gmail.metadata — headers and labels only.
 * Every metadata request also sets `fields=` so a body or snippet can't come back even by accident.
 */
import { METADATA_HEADERS } from "./classify";
import { GOOGLE_ENDPOINTS, SYNC_LIMITS, type GoogleEndpoints } from "./config";
import { MailAuthRevokedError, MailHttpError, MailRateLimitedError, type ChangesPage, type ListPage, type MailClient, type MailMessage } from "./provider";

export type GoogleTokens = { accessToken: string | null; expiresAt: number | null; refreshToken: string };

export type GoogleClientOpts = {
  clientId: string;
  clientSecret: string;
  tokens: GoogleTokens;
  /** Persist refreshed tokens (encrypted by the caller). */
  onTokens?: (t: { accessToken: string; expiresAt: number; refreshToken?: string }) => Promise<void> | void;
  endpoints?: Partial<GoogleEndpoints>;
  fetch?: typeof fetch;
  concurrency?: number;
  timeoutMs?: number;
};

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

/** POST the token endpoint. invalid_grant → MailAuthRevokedError. */
export async function googleTokenRequest(
  params: Record<string, string>,
  opts: { endpoints?: Partial<GoogleEndpoints>; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<TokenResponse> {
  const f = opts.fetch ?? fetch;
  const res = await f(opts.endpoints?.token ?? GOOGLE_ENDPOINTS.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (body.error === "invalid_grant" || body.error === "unauthorized_client") throw new MailAuthRevokedError();
    if (res.status === 429) throw new MailRateLimitedError("token endpoint rate limited");
    throw new MailHttpError(res.status, `google token ${res.status}: ${body.error ?? "error"}`);
  }
  return body;
}

/** Best-effort revoke at Google (disconnect). Never throws. */
export async function revokeGoogleToken(token: string, opts: { endpoints?: Partial<GoogleEndpoints>; fetch?: typeof fetch } = {}): Promise<boolean> {
  try {
    const res = await (opts.fetch ?? fetch)(opts.endpoints?.revoke ?? GOOGLE_ENDPOINTS.revoke, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    // 400 invalid_token = already revoked: as good as done.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

/** Run `fn` over `items` with at most `limit` in flight. Keeps input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

type GmailMessage = { id: string; threadId?: string; labelIds?: string[]; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };

export class GoogleMailClient implements MailClient {
  readonly provider = "google" as const;
  private tokens: GoogleTokens;
  private refreshing: Promise<void> | null = null;
  private readonly f: typeof fetch;
  private readonly ep: GoogleEndpoints;

  constructor(private readonly o: GoogleClientOpts) {
    this.tokens = { ...o.tokens };
    this.f = o.fetch ?? fetch;
    this.ep = { ...GOOGLE_ENDPOINTS, ...o.endpoints };
  }

  /** Refresh once even when many parallel requests hit a 401 together. */
  private refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const t = await googleTokenRequest(
          { client_id: this.o.clientId, client_secret: this.o.clientSecret, refresh_token: this.tokens.refreshToken, grant_type: "refresh_token" },
          { endpoints: this.ep, fetch: this.f, timeoutMs: this.o.timeoutMs },
        );
        if (!t.access_token) throw new MailHttpError(500, "google token: no access_token");
        const expiresAt = Date.now() + (t.expires_in ?? 3600) * 1000;
        this.tokens = { accessToken: t.access_token, expiresAt, refreshToken: t.refresh_token ?? this.tokens.refreshToken };
        await this.o.onTokens?.({ accessToken: t.access_token, expiresAt, refreshToken: t.refresh_token });
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async token(): Promise<string> {
    if (!this.tokens.accessToken || (this.tokens.expiresAt ?? 0) < Date.now() + 60_000) await this.refresh();
    return this.tokens.accessToken!;
  }

  /** GET a Gmail path. 401 → refresh + retry once. 404 → null. 429/rate-limit 403 → MailRateLimitedError. */
  private async get<T>(path: string, params: [string, string][] = []): Promise<T | null> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.ep.gmail}${path}${qs ? `?${qs}` : ""}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const used = await this.token();
      const res = await this.f(url, {
        headers: { authorization: `Bearer ${used}`, accept: "application/json" },
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
      });
      if (res.status === 401 && attempt === 0) {
        // Another request may already have refreshed it.
        if (this.tokens.accessToken === used) this.tokens.accessToken = null;
        continue;
      }
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason ?? "";
      if (res.status === 429 || (res.status === 403 && /rateLimit|userRateLimit|quota/i.test(reason))) throw new MailRateLimitedError(`gmail ${res.status} ${reason}`);
      if (res.status === 401) throw new MailAuthRevokedError();
      throw new MailHttpError(res.status, `gmail ${path.split("?")[0]} ${res.status}: ${body.error?.message ?? reason ?? "error"}`);
    }
    throw new MailAuthRevokedError();
  }

  async profile() {
    const p = await this.get<{ emailAddress: string; historyId: string }>("/profile");
    if (!p) throw new MailHttpError(404, "gmail profile not found");
    return { email: p.emailAddress.toLowerCase(), cursor: String(p.historyId) };
  }

  async listRecent(pageToken?: string): Promise<ListPage> {
    const params: [string, string][] = [
      ["maxResults", "100"],
      ["includeSpamTrash", "false"],
      ["fields", "messages/id,nextPageToken"],
    ];
    if (pageToken) params.push(["pageToken", pageToken]);
    const r = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", params);
    return { ids: (r?.messages ?? []).map((m) => m.id), nextPageToken: r?.nextPageToken };
  }

  async changesSince(cursor: string, pageToken?: string): Promise<ChangesPage | "expired"> {
    const params: [string, string][] = [
      ["startHistoryId", cursor],
      ["historyTypes", "messageAdded"],
      ["maxResults", "500"],
      ["fields", "history/messagesAdded/message/id,nextPageToken,historyId"],
    ];
    if (pageToken) params.push(["pageToken", pageToken]);
    const r = await this.get<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId?: string }>("/history", params);
    if (r === null) return "expired"; // 404: startHistoryId is too old
    const ids = [...new Set((r.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((a) => a.message.id)))];
    return { ids, nextPageToken: r.nextPageToken, cursor: String(r.historyId ?? cursor) };
  }

  async getMetadata(ids: string[]): Promise<MailMessage[]> {
    const params: [string, string][] = [["format", "metadata"], ...METADATA_HEADERS.map((h) => ["metadataHeaders", h] as [string, string]), ["fields", "id,threadId,labelIds,internalDate,payload/headers"]];
    const got = await mapLimit(ids, this.o.concurrency ?? SYNC_LIMITS.concurrency, (id) => this.get<GmailMessage>(`/messages/${encodeURIComponent(id)}`, params));
    return got.filter((m): m is GmailMessage => !!m).map(toMailMessage);
  }
}

export function toMailMessage(g: GmailMessage): MailMessage {
  const headers: Record<string, string> = {};
  for (const h of g.payload?.headers ?? []) {
    const k = h.name.toLowerCase();
    headers[k] = headers[k] !== undefined ? `${headers[k]}, ${h.value}` : h.value;
  }
  return { id: g.id, threadId: g.threadId, internalDate: Number(g.internalDate ?? 0), labels: g.labelIds ?? [], headers };
}

/** Claims from a Google id_token (received directly from Google's token endpoint over TLS, so not re-verified). */
export function idTokenClaims(idToken: string | undefined): { email?: string; email_verified?: boolean; aud?: string; sub?: string } {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
