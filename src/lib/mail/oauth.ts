import "server-only";
import type { NextRequest } from "next/server";
import { GMAIL_SCOPE, GOOGLE_ENDPOINTS, GOOGLE_SCOPES } from "./config";

export const STATE_COOKIE = "dilly_mail_oauth";
export const CALLBACK_PATH = "/api/mail/google/callback";

/** Public origin of the app. Must match the redirect URI registered on the Google OAuth client exactly. */
export function appOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request origin
    }
  }
  return req.nextUrl.origin;
}

export function googleAuthUrl(opts: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const u = new URL(GOOGLE_ENDPOINTS.auth);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", opts.state);
  if (opts.loginHint) u.searchParams.set("login_hint", opts.loginHint);
  return u.toString();
}

export function hasGmailScope(scope: string | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(GMAIL_SCOPE);
}

export const stateCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/api/mail/google",
  maxAge: 600,
});
