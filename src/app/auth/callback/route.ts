import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Magic-link / OAuth landing: trade the code (PKCE) or token hash for a session, then go where the user was headed.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const rawNext = url.searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app/today";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const sb = await supabaseServer();
  let ok = false;
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  }

  const to = url.clone();
  to.search = "";
  if (ok) {
    to.pathname = next;
  } else {
    to.pathname = "/login";
    to.searchParams.set("error", "link");
    to.searchParams.set("next", next);
  }
  return NextResponse.redirect(to);
}
