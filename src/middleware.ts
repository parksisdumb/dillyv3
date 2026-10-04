import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { log, newId, REQUEST_ID_HEADER } from "@/lib/observability/log";
import { resilientFetch } from "@/lib/supabase/fetch";

/**
 * Every page request:
 *  1. gets a request id (x-request-id, on the request for server code and on the response for support),
 *  2. refreshes the Supabase session cookie,
 *  3. keeps /app behind sign-in.
 *
 * It must never crash or hang a request. If Supabase auth is slow or unreachable:
 *  - public routes (/, /login, /auth/*, /no-access, /preview) pass through untouched;
 *  - /app routes go to /login?offline=1 with a "can't reach the server" notice (the session cookie is kept,
 *    so the rep is back in as soon as the server answers).
 */

// Auth check gets a short leash: one attempt, 4 s. A page that can't verify the user fast enough is better
// served by the offline notice than by a spinner.
const authFetch = resilientFetch({ timeoutMs: 4_000, retries: 0, label: "middleware" });

const ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function withRequestHeaders(request: NextRequest, requestId: string) {
  const h = new Headers(request.headers);
  h.set(REQUEST_ID_HEADER, requestId);
  h.set("x-pathname", request.nextUrl.pathname);
  return h;
}

function isAuthUnavailable(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  return typeof error.status === "number" && (error.status === 0 || error.status >= 500);
}

export async function middleware(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && ID_RE.test(incoming) ? incoming : newId();
  const path = request.nextUrl.pathname;
  const needsAuth = path === "/app" || path.startsWith("/app/");
  const started = Date.now();

  const requestHeaders = withRequestHeaders(request, requestId);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const finish = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (needsAuth) log.error("middleware:supabase-env-missing", { requestId, route: path });
    return finish(response);
  }

  let user: { id: string } | null = null;
  let unavailable = false;
  try {
    const supabase = createServerClient(url, key, {
      global: { fetch: authFetch },
      db: { retry: false },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: withRequestHeaders(request, requestId) } });
          all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    if (!user && isAuthUnavailable(error as { name?: string; status?: number } | null)) {
      unavailable = true;
      log.warn("middleware:auth-unavailable", { requestId, route: path, durationMs: Date.now() - started, err: error });
    }
  } catch (err) {
    // Corrupt cookie, edge runtime hiccup, anything: never 500 the request from here.
    unavailable = true;
    log.error("middleware:auth-crashed", { requestId, route: path, durationMs: Date.now() - started, err });
  }

  if (!user && needsAuth) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    to.searchParams.set("next", path + request.nextUrl.search);
    if (unavailable) to.searchParams.set("offline", "1");
    const redirect = NextResponse.redirect(to);
    // Keep whatever session cookies Supabase refreshed/cleared on the way.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return finish(redirect);
  }
  return finish(response);
}

export const config = {
  // Static assets, Inngest and the health probe never touch auth.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/inngest|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)"],
};
