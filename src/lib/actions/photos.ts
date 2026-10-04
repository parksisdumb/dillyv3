"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { storageFor } from "@/lib/storage";
import { parseMediaPath, pathInTenants } from "@/lib/storage/paths";

const photoInput = z.object({
  id: z.string().uuid(),
  path: z.string().max(200),
  width: z.number().int().min(1).max(20000).nullish(),
  height: z.number().int().min(1).max(20000).nullish(),
  takenAt: z.iso.datetime({ offset: true }).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  caption: z.string().trim().max(300).nullish(),
});

/** Property detail → Photos → Add: photos straight onto the building (no touch, so no points). */
export async function addPropertyPhotos(input: { propertyId: string; photos: z.input<typeof photoInput>[] }): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const parsed = z.object({ propertyId: z.string().uuid(), photos: z.array(photoInput).min(1).max(12) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the photos." };
  const { propertyId, photos } = parsed.data;
  const { sb, s, tenantId } = await ctx();
  if (photos.some((p) => !pathInTenants(p.path, [tenantId]) || parseMediaPath(p.path)?.id !== p.id.toLowerCase())) {
    return { ok: false, error: "A photo doesn't belong to this company." };
  }
  const have = await storageFor(sb).exists(photos.map((p) => p.path));
  if (have.size !== photos.length) return { ok: false, error: "A photo didn't finish uploading. Try again." };
  const { data: prop } = await sb.from("property").select("id,account_id").eq("tenant_id", tenantId).eq("id", propertyId).maybeSingle();
  if (!prop) return { ok: false, error: "That property isn't here anymore." };
  const { error } = await sb.from("photo").upsert(
    photos.map((p) => ({
      id: p.id,
      tenant_id: tenantId,
      property_id: propertyId,
      account_id: prop.account_id,
      path: p.path,
      caption: p.caption || null,
      taken_at: p.takenAt ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      created_by: s.userId,
    })),
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: dbMessage(error, "add the photos") };
  revalidatePath(`/app/properties/${propertyId}`);
  return { ok: true, added: photos.length };
}

export async function updatePhotoCaption(input: { id: string; caption: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.object({ id: z.string().uuid(), caption: z.string().trim().max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Caption is too long." };
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb
    .from("photo")
    .update({ caption: parsed.data.caption || null })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.id)
    .select("id,property_id");
  if (error) return { ok: false, error: dbMessage(error, "save the caption") };
  if (!data?.length) return { ok: false, error: "Only the person who took it (or a manager) can change the caption." };
  if (data[0].property_id) revalidatePath(`/app/properties/${data[0].property_id}`);
  return { ok: true };
}
