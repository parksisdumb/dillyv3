/**
 * VAPID config for Web Push, from env. Missing or partial → null, and reminders fall back to record-only
 * (the decisions are still written as `insight` rows). Read straight from process.env so a missing key never
 * stops the app from booting.
 *
 *   VAPID_PUBLIC_KEY   base64url P-256 public key (also sent to browsers to subscribe)
 *   VAPID_PRIVATE_KEY  base64url private key (server only)
 *   VAPID_SUBJECT      contact for push services, e.g. mailto:team@dillyos.com
 *
 * Generate a pair with `npx tsx scripts/gen-vapid.ts`.
 */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

export const DEFAULT_VAPID_SUBJECT = "mailto:team@dillyos.com";

export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const raw = env.VAPID_SUBJECT?.trim();
  const subject = raw && /^(mailto:|https:\/\/)/.test(raw) ? raw : DEFAULT_VAPID_SUBJECT;
  return { publicKey, privateKey, subject };
}

/** Public key only — safe to hand to the browser. */
export function vapidPublicKey(env: Record<string, string | undefined> = process.env): string | null {
  return vapidConfig(env)?.publicKey ?? null;
}
