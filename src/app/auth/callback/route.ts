import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/server/safe-next";
import { log, REQUEST_ID_HEADER } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

// Magic-link / OAuth landing: trade the code (PKCE) or token hash for a session, then go where the user was headed.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  try {
    const sb = await supabaseServer();
    if (code) {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      ok = !error;
      if (error) log.warn("auth:callback-failed", { requestId: request.headers.get(REQUEST_ID_HEADER), err: error });
    } else if (tokenHash && type) {
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
      ok = !error;
      if (error) log.warn("auth:callback-failed", { requestId: request.headers.get(REQUEST_ID_HEADER), err: error });
    }
  } catch (err) {
    log.error("auth:callback-crashed", { requestId: request.headers.get(REQUEST_ID_HEADER), err });
  }

  const to = url.clone();
  to.search = "";
  if (ok) {
    // next is a sanitized relative path that may carry its own query string.
    return NextResponse.redirect(new URL(next, url.origin));
  } else {
    to.pathname = "/login";
    to.searchParams.set("error", "link");
    to.searchParams.set("next", next);
  }
  return NextResponse.redirect(to);
}
