import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { googleMailConfig } from "@/lib/mail/config";
import { signState } from "@/lib/mail/crypto";
import { appOrigin, CALLBACK_PATH, googleAuthUrl, STATE_COOKIE, stateCookieOptions } from "@/lib/mail/oauth";

export const dynamic = "force-dynamic";

/**
 * Settings → "Continue with Google": send the signed-in rep to Google's consent screen for gmail.metadata.
 * The state is an HMAC-signed, 10-minute token (user + active tenant + nonce), also set as an httpOnly cookie;
 * the callback requires both and the same signed-in user.
 */
export async function GET(req: NextRequest) {
  const cfg = googleMailConfig();
  if (!cfg) return NextResponse.redirect(new URL("/app/settings?mail=not_configured", appOrigin(req)));
  const s = await getSession(); // redirects to /login when signed out
  const origin = appOrigin(req);
  const state = signState({ u: s.userId, t: s.tenant.id }, cfg.tokenKey);
  const res = NextResponse.redirect(googleAuthUrl({ clientId: cfg.clientId, redirectUri: origin + CALLBACK_PATH, state, loginHint: s.email || undefined }));
  res.cookies.set(STATE_COOKIE, state, stateCookieOptions(origin.startsWith("https://")));
  res.headers.set("cache-control", "no-store");
  return res;
}
