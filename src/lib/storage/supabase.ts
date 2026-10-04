import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET } from "@/lib/storage/paths";
import { SIGNED_URL_TTL_SEC, type StorageDriver } from "@/lib/storage/types";

/**
 * Supabase Storage, private bucket 'media'. Pass the signed-in user's client: the storage.objects policies
 * (first path segment = a tenant the user belongs to) are the authorization. Display uses signed URLs (1 hour).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- works with any typed client
export function supabaseDriver(sb: SupabaseClient<any, any, any>): StorageDriver {
  const bucket = () => sb.storage.from(MEDIA_BUCKET);
  const d: StorageDriver = {
    name: "supabase",
    async put(key, bytes, contentType) {
      const { error } = await bucket().upload(key, bytes, { contentType, upsert: true, cacheControl: "3600" });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await bucket().download(key);
      if (error || !data) return null;
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "image/jpeg" };
    },
    async signedUrls(keys, expiresInSec = SIGNED_URL_TTL_SEC) {
      const out = new Map<string, string>();
      if (!keys.length) return out;
      const { data, error } = await bucket().createSignedUrls(keys, expiresInSec);
      if (error || !data) return out;
      for (const d of data) if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl);
      return out;
    },
    async exists(keys) {
      return new Set((await d.signedUrls(keys, 60)).keys());
    },
  };
  return d;
}
