import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { storageFor } from "@/lib/storage";

export type PhotoView = {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
  mine: boolean;
  width: number | null;
  height: number | null;
  touchId: string | null;
};

/** A building's photos, newest first, with 1-hour display URLs. Missing objects (deleted / not uploaded) are skipped. */
export async function loadPropertyPhotos(c: Ctx, propertyId: string, limit = 60): Promise<PhotoView[]> {
  const { sb, s, tenantId } = c;
  const { data } = await sb
    .from("photo")
    .select("id,path,caption,taken_at,created_at,created_by,width,height,touch_id")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  if (!rows.length) return [];
  const people = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x))];
  const [urls, names] = await Promise.all([
    storageFor(sb).signedUrls(rows.map((r) => r.path)),
    people.length ? sb.from("profile").select("id,full_name,email").in("id", people) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);
  const who = new Map((names.data ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  return rows.flatMap((r) => {
    const url = urls.get(r.path);
    if (!url) return [];
    return [
      {
        id: r.id,
        url,
        caption: r.caption,
        takenAt: r.taken_at ?? r.created_at,
        by: r.created_by ? who.get(r.created_by) ?? null : null,
        mine: r.created_by === s.userId,
        width: r.width,
        height: r.height,
        touchId: r.touch_id,
      },
    ];
  });
}
