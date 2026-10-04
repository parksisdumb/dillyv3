/** A place to keep photo / card-scan bytes. Server-only implementations: Supabase Storage (production) and local disk (dev/e2e). */
export interface StorageDriver {
  readonly name: "supabase" | "local";
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Display URLs for these keys (expire after `expiresInSec`). Missing objects are left out of the map. */
  signedUrls(paths: string[], expiresInSec?: number): Promise<Map<string, string>>;
  /** The subset of `paths` that exist. */
  exists(paths: string[]): Promise<Set<string>>;
}

/** Signed URLs live one hour: long enough for a field session, short enough that a leaked link dies. */
export const SIGNED_URL_TTL_SEC = 3600;
