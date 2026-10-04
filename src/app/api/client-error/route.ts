import { NextResponse, type NextRequest } from "next/server";
import { log, newId, REQUEST_ID_HEADER } from "@/lib/observability/log";
import { clientIp, MAX_BODY_BYTES, parseClientErrors, tokenBuckets } from "@/lib/observability/client-error";

/**
 * POST /api/client-error — browser errors (window.onerror, unhandled rejections, error boundaries), batched by
 * src/lib/observability/client-reporter.ts via navigator.sendBeacon. Logged as level=error, msg=client:error, with
 * the request id. No auth (errors on the sign-in screen matter too); size-limited and rate-limited per IP.
 */
export const runtime = "nodejs";

// 20 reports per IP burst, refilling 1 every 3 s. Per server instance.
const limiter = tokenBuckets({ capacity: 20, refillPerSec: 1 / 3 });

export async function POST(req: NextRequest) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? newId();
  const headers = { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" };
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413, headers });
  const ip = clientIp(req.headers);
  let raw: string;
  try {
    raw = await readLimited(req, MAX_BODY_BYTES + 1);
  } catch {
    return new NextResponse(null, { status: 400, headers });
  }
  const parsed = parseClientErrors(raw);
  if (!parsed.ok) return new NextResponse(null, { status: parsed.status, headers });
  if (!limiter.take(ip, parsed.errors.length)) {
    log.warn("client:error-rate-limited", { requestId, n: parsed.errors.length });
    return new NextResponse(null, { status: 429, headers: { ...headers, "Retry-After": "30" } });
  }
  for (const e of parsed.errors) {
    const { stack, message, user, tenant, ...rest } = e;
    const err = new Error(message);
    err.name = "ClientError";
    err.stack = stack ?? `ClientError: ${message}`;
    log.error("client:error", {
      requestId,
      user: user ?? null,
      tenant: tenant ?? null,
      route: e.url ? safePath(e.url) : null,
      ...rest,
      err,
    });
  }
  return new NextResponse(null, { status: 204, headers });
}

function safePath(u: string): string | null {
  try {
    return new URL(u).pathname;
  } catch {
    return null;
  }
}

/** Read at most `limit` bytes of the body (a lying content-length can't make us buffer megabytes). */
async function readLimited(req: NextRequest, limit: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) {
      await reader.cancel().catch(() => {});
      return "x".repeat(limit); // parse step answers 413
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
