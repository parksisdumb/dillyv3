import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getSession } from "@/lib/session";
import { googleMailConfig } from "@/lib/mail/config";
import { sameToken, verifyState } from "@/lib/mail/crypto";
import { GoogleMailClient, googleTokenRequest, idTokenClaims, revokeGoogleToken } from "@/lib/mail/google";
import { appOrigin, CALLBACK_PATH, hasGmailScope, STATE_COOKIE, stateCookieOptions } from "@/lib/mail/oauth";
import { saveGoogleConnection } from "@/lib/mail/server";
import { requestMailSync } from "@/lib/mail/request";
import { log } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

/**
 * Google redirects here with ?code&state (or ?error=access_denied). Verify state + cookie + signed-in user,
 * exchange the code, check the gmail.metadata box was actually ticked, encrypt + store the tokens, queue the
 * first (30-day) sync, and land back on Settings with ?mail=<result>.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/app/settings?mail=${result}#email`, origin));
    res.cookies.set(STATE_COOKIE, "", { ...stateCookieOptions(origin.startsWith("https://")), maxAge: 0 });
    res.headers.set("cache-control", "no-store");
    return res;
  };

  const cfg = googleMailConfig();
  if (!cfg) return done("not_configured");

  const p = req.nextUrl.searchParams;
  const state = p.get("state");
  const check = verifyState(state, cfg.tokenKey);
  if (!check.ok || !sameToken(state, req.cookies.get(STATE_COOKIE)?.value)) {
    log.warn("mail:oauth-bad-state", { reason: check.ok ? "cookie_mismatch" : check.reason });
    return done("expired");
  }
  const s = await getSession();
  if (s.userId !== check.state.u || !s.tenants.some((t) => t.id === check.state.t)) {
    log.warn("mail:oauth-user-mismatch", { user: s.userId });
    return done("expired");
  }
  if (p.get("error")) return done(p.get("error") === "access_denied" ? "denied" : "error");
  const code = p.get("code");
  if (!code) return done("error");

  try {
    const t = await googleTokenRequest({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: origin + CALLBACK_PATH,
      grant_type: "authorization_code",
    });
    if (!t.access_token) return done("error");
    if (!hasGmailScope(t.scope)) {
      // They unticked "View your email message metadata" on the consent screen.
      await revokeGoogleToken(t.refresh_token ?? t.access_token);
      return done("scope");
    }
    if (!t.refresh_token) return done("error"); // prompt=consent always returns one; be safe
    const claims = idTokenClaims(t.id_token);
    let email = claims.aud === cfg.clientId && claims.email_verified !== false ? claims.email : undefined;
    if (!email) {
      const client = new GoogleMailClient({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        tokens: { accessToken: t.access_token, expiresAt: Date.now() + 3_000_000, refreshToken: t.refresh_token },
      });
      email = (await client.profile()).email;
    }
    const connectionId = await saveGoogleConnection({
      tenantId: check.state.t,
      userId: s.userId,
      email,
      scopes: (t.scope ?? "").split(/\s+/).filter(Boolean),
      refreshToken: t.refresh_token,
      accessToken: t.access_token,
      expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
      key: cfg.tokenKey,
    });
    log.info("mail:connected", { tenant: check.state.t, user: s.userId, connection: connectionId, provider: "google" });
    await requestMailSync(connectionId, check.state.t, "connected");
    return done("connected");
  } catch (err) {
    unstable_rethrow(err);
    log.error("mail:oauth-callback-failed", { tenant: check.state.t, user: s.userId, err });
    return done("error");
  }
}
