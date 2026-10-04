/**
 * Mail sync configuration. Read straight from process.env (empty = unset) so a missing or malformed value
 * hides the feature instead of stopping the app from booting.
 *
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  — the OAuth client (Google Cloud console; see docs/RUNBOOK.md)
 *   MAIL_TOKEN_KEY                          — 32 random bytes, base64 (`openssl rand -base64 32`)
 */

export type GoogleMailConfig = { clientId: string; clientSecret: string; tokenKey: Buffer };

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** The 32-byte key, or null when unset/invalid. */
export function mailTokenKey(): Buffer | null {
  const raw = read("MAIL_TOKEN_KEY");
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** Google OAuth + token key, or null when Gmail sync isn't configured (the UI then hides itself). */
export function googleMailConfig(): GoogleMailConfig | null {
  const clientId = read("GOOGLE_CLIENT_ID");
  const clientSecret = read("GOOGLE_CLIENT_SECRET");
  const tokenKey = mailTokenKey();
  if (!clientId || !clientSecret || !tokenKey) return null;
  return { clientId, clientSecret, tokenKey };
}

export function isGoogleMailConfigured(): boolean {
  return googleMailConfig() !== null;
}

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
export const GOOGLE_SCOPES = ["openid", "email", GMAIL_SCOPE] as const;

/** Endpoints, overridable in tests (fake Gmail server). */
export const GOOGLE_ENDPOINTS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  gmail: "https://gmail.googleapis.com/gmail/v1/users/me",
};
export type GoogleEndpoints = typeof GOOGLE_ENDPOINTS;

/** Sync knobs. */
export const SYNC_LIMITS = {
  /** Stop a run after this many message fetches; the next tick continues. */
  maxMessagesPerRun: 500,
  /** Parallel metadata fetches. */
  concurrency: 10,
  /** First sync looks back this far. */
  backfillDays: 30,
  /** Backfilled mail older than this logs the touch but schedules no follow-up task. */
  followUpWindowDays: 7,
};
