"use client";
import { useEffect, useState } from "react";
import { log, newId, shortRef } from "@/lib/observability/log";

/**
 * Last line of defence: the root layout itself failed, so globals.css and fonts may be missing.
 * Inline styles only; plain links (no client router) so it works even when the JS bundle is half-loaded.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const [clientId] = useState(() => newId());
  const ref = shortRef(error.digest ?? clientId);
  useEffect(() => {
    log.error("boundary:global", { ref, digest: error.digest ?? null, err: error });
  }, [error, ref]);

  const button: React.CSSProperties = {
    display: "block",
    width: "100%",
    minHeight: 56,
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 600,
    textAlign: "center",
    lineHeight: "56px",
    textDecoration: "none",
    marginTop: 12,
  };
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f6f3", color: "#15202b", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 420, margin: "0 auto", padding: "64px 16px" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5b6670", margin: 0 }}>Dilly</p>
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: "6px 0 0" }}>That didn&apos;t load.</h1>
          <p style={{ fontSize: 16, color: "#5b6670", marginTop: 8 }}>
            Something on our end hiccuped. Anything you already logged is saved. Give it another try.
          </p>
          <a href="" style={{ ...button, background: "#e4570f", color: "#fff" }}>
            Try again
          </a>
          <a href="/app/today" style={{ ...button, border: "2px solid #d9ddd8", color: "#15202b" }}>
            Go to Today
          </a>
          <p style={{ fontSize: 12, color: "#5b6670", marginTop: 16 }}>
            Ref <strong>{ref}</strong> — mention it if this keeps happening.
          </p>
        </main>
      </body>
    </html>
  );
}
