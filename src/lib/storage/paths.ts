// Storage keys for photos and card scans. Pure (client + server).
//
//   <tenant_id>/<yyyy>/<mm>/<uuid>.jpg
//
// The first segment is the tenant: Supabase Storage policies (20261004300000_field_kit.sql) and the local driver's
// file route both authorize on it. The uuid is generated on the phone, so a replayed upload overwrites itself.

export const MEDIA_BUCKET = "media";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{4})\/(\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/i;

export type MediaPathParts = { tenantId: string; year: string; month: string; id: string };

/** Build the key. Month comes from `at` in UTC (stable across replays of the same capture). */
export function mediaPath(tenantId: string, id: string, at: Date = new Date()): string {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(id)) throw new Error("mediaPath: tenant and id must be uuids");
  const d = Number.isNaN(at.getTime()) ? new Date() : at;
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${tenantId.toLowerCase()}/${yyyy}/${mm}/${id.toLowerCase()}.jpg`;
}

/** Parse and validate a key; null for anything that isn't exactly our shape (no "..", no extra segments). */
export function parseMediaPath(path: string | null | undefined): MediaPathParts | null {
  if (!path || path.length > 200) return null;
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const month = Number(m[3]);
  if (month < 1 || month > 12) return null;
  return { tenantId: m[1].toLowerCase(), year: m[2], month: m[3], id: m[4].toLowerCase() };
}

/** True when the key is well-formed and lives under one of `tenantIds`. */
export function pathInTenants(path: string, tenantIds: readonly string[]): boolean {
  const p = parseMediaPath(path);
  return !!p && tenantIds.some((t) => t.toLowerCase() === p.tenantId);
}

/** One photo as stored in touch.media (and copied to public.photo by the touch_media trigger). */
export type MediaItem = {
  kind: "photo";
  id: string;
  path: string;
  width?: number | null;
  height?: number | null;
  taken_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  caption?: string | null;
};
