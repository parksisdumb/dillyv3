import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseMediaPath } from "@/lib/storage/paths";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * Local filesystem driver (STORAGE_DRIVER=local) for dev and the e2e stack, which has no Storage API.
 * Files live under STORAGE_LOCAL_DIR (default <cwd>/.data/media) and are served by the authenticated route
 * /api/media/file/<key> (it checks the first segment is one of the viewer's tenants). Not for Vercel: its disk is
 * read-only and per-instance.
 */
export function localRoot(): string {
  return path.resolve(process.env.STORAGE_LOCAL_DIR?.trim() || path.join(process.cwd(), ".data", "media"));
}

function fileFor(key: string): string {
  if (!parseMediaPath(key)) throw new Error("invalid media key");
  const root = localRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid media key");
  return full;
}

export const LOCAL_FILE_ROUTE = "/api/media/file/";

export function localDriver(): StorageDriver {
  const d: StorageDriver = {
    name: "local",
    async put(key, bytes) {
      const file = fileFor(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, file); // atomic: a reader never sees half a photo
    },
    async get(key) {
      try {
        return { bytes: new Uint8Array(await fs.readFile(fileFor(key))), contentType: "image/jpeg" };
      } catch {
        return null;
      }
    },
    async signedUrls(keys) {
      const have = await d.exists(keys);
      return new Map([...have].map((k) => [k, LOCAL_FILE_ROUTE + k]));
    },
    async exists(keys) {
      const out = new Set<string>();
      await Promise.all(
        keys.map(async (k) => {
          try {
            await fs.access(fileFor(k));
            out.add(k);
          } catch {
            /* missing or invalid */
          }
        }),
      );
      return out;
    },
  };
  return d;
}
