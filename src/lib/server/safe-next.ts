/**
 * Sanitize a post-login `next` destination. Only same-origin relative paths survive; anything that a
 * browser could resolve to another host ("//evil.com", "/\evil.com", "https://…", "javascript:…",
 * encoded or control-character tricks) falls back to the default.
 *
 * No "server-only": middleware (Edge), route handlers, server actions and pages all use it.
 */
export const DEFAULT_NEXT = "/app/today";

const ORIGIN = "https://dilly.invalid";

export function safeNext(raw: string | null | undefined, fallback: string = DEFAULT_NEXT): string {
  if (typeof raw !== "string") return fallback;
  const n = raw.trim();
  if (!n || n.length > 2048) return fallback;
  if (!n.startsWith("/") || n.startsWith("//")) return fallback;
  // Browsers treat "\" like "/" in URLs ("/\evil.com" → "//evil.com"); control chars can hide either.
  if (/[\\\u0000-\u001f\u007f]/.test(n)) return fallback;
  let u: URL;
  try {
    u = new URL(n, ORIGIN);
  } catch {
    return fallback;
  }
  if (u.origin !== ORIGIN) return fallback;
  // Dot segments can collapse into a protocol-relative path ("/..//evil.com" → "//evil.com").
  if (u.pathname.startsWith("//")) return fallback;
  // Never bounce back into the auth flow itself.
  if (u.pathname === "/login" || u.pathname.startsWith("/auth/")) return fallback;
  return u.pathname + u.search + u.hash;
}
