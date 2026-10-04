/**
 * Prints a fresh VAPID key pair for Web Push. Set all three in Vercel (Production + Preview):
 *
 *   npx tsx scripts/gen-vapid.ts
 *
 * Generate ONCE per environment and keep it: rotating the keys invalidates every phone's subscription
 * (reps would have to turn reminders back on in Settings → Notifications).
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:team@dillyos.com");
