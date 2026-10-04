import type { NextConfig } from "next";

/**
 * Security headers for every route.
 *
 * CSP notes:
 * - Fonts come from next/font/google, which downloads them at BUILD time and serves them from
 *   /_next/static/media — the browser never talks to Google, so no Google hosts are allowed.
 * - The App Router streams inline <script> chunks without a nonce, so script-src needs 'unsafe-inline'.
 *   (Moving to nonces means a per-request CSP in middleware and dynamic rendering everywhere — post-launch.)
 * - Supabase: REST/Auth over https, Realtime over wss, Storage images (card scans / roof photos).
 * - Inngest is server-to-server; it's listed in connect-src only so a future client SDK call isn't blocked.
 * - frame-ancestors 'none' (+ X-Frame-Options DENY for old browsers): Dilly is never embedded.
 */
function supabaseOrigin(): string | null {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  const sb = supabaseOrigin();
  const sbWs = sb ? sb.replace(/^http/, "ws") : null;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(sb ? [sb] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(sb ? [sb] : []), ...(sbWs ? [sbWs] : []), "https://*.inngest.com", ...(dev ? ["ws:"] : [])],
    "media-src": ["'self'", "blob:", ...(sb ? [sb] : [])],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  // Only on Vercel (always https): on `next start` over http://localhost it would break local e2e runs.
  if (!dev && process.env.VERCEL === "1") parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Reps use the camera (card scans, roof photos), mic (voice notes) and location (Go) — this origin only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), browsing-topics=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Probes and webhooks must never be cached by a CDN in between.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;
