import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { storageFor } from "@/lib/storage";
import { mediaPath, UUID_RE } from "@/lib/storage/paths";
import { log, newId, REQUEST_ID_HEADER } from "@/lib/observability/log";

/**
 * POST /api/media — one downscaled JPEG (multipart: file, id, kind, at?, tenantId?) → { ok, path }.
 * The phone already resized it (≤1600 px, ~0.8); this only checks, names and stores it.
 * Idempotent: the key comes from the client-generated id, so a replayed upload overwrites the same object.
 */
export const runtime = "nodejs";
const MAX_BYTES = 6 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>, requestId: string) =>
  NextResponse.json(body, { status, headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? newId();
  const started = Date.now();
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES + 64 * 1024) return json(413, { ok: false, error: "That photo is too big (6 MB max)." }, requestId);

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return json(401, { ok: false, error: "Sign in again to upload photos." }, requestId);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { ok: false, error: "Upload was cut off. Try again." }, requestId);
  }
  const file = form.get("file");
  const id = String(form.get("id") ?? "");
  const kind = form.get("kind") === "card" ? "card" : "photo";
  if (!(file instanceof Blob) || file.size === 0) return json(400, { ok: false, error: "No photo in the upload." }, requestId);
  if (file.size > MAX_BYTES) return json(413, { ok: false, error: "That photo is too big (6 MB max)." }, requestId);
  if (!UUID_RE.test(id)) return json(400, { ok: false, error: "Bad photo id." }, requestId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // JPEG magic: we only ever store what the phone's canvas produced.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json(415, { ok: false, error: "Photos must be JPEG." }, requestId);

  let tenantId: string;
  try {
    const s = await getSession();
    const wanted = String(form.get("tenantId") ?? "");
    const t = wanted ? s.tenants.find((x) => x.id === wanted) : s.tenant;
    if (!t) return json(403, { ok: false, error: "That photo belongs to a company you're not in." }, requestId);
    tenantId = t.id;
  } catch (err) {
    log.warn("media:upload:session", { requestId, user: user.id, err });
    return json(503, { ok: false, error: "Can't reach the server right now." }, requestId);
  }

  const atRaw = Date.parse(String(form.get("at") ?? ""));
  const at = Number.isFinite(atRaw) && atRaw < Date.now() + 86_400_000 && atRaw > Date.now() - 400 * 86_400_000 ? new Date(atRaw) : new Date();
  const path = mediaPath(tenantId, id, at);
  try {
    await storageFor(sb).put(path, bytes, "image/jpeg");
  } catch (err) {
    log.error("media:upload:failed", { requestId, tenant: tenantId, user: user.id, kind, bytes: bytes.length, durationMs: Date.now() - started, err });
    return json(502, { ok: false, error: "Couldn't save the photo. Try again." }, requestId);
  }
  log.info("media:upload", { requestId, tenant: tenantId, user: user.id, kind, bytes: bytes.length, durationMs: Date.now() - started });
  return json(200, { ok: true, path }, requestId);
}
