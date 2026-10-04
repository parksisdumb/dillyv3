"use client";
import { useState } from "react";
import { IconX } from "@/components/icons";
import { MAIL_PROMPT_COOKIE } from "@/lib/mail/prompt-cookie";

/** The prompt's frame + dismiss (remembered for 30 days in a cookie, so the server doesn't render it again). */
export function DismissMailPrompt({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside aria-label="Connect your email" className="mx-4 mt-4 flex items-center gap-3 rounded-lg border-2 border-line bg-surface py-3 pl-4 pr-1">
      {children}
      <button
        type="button"
        aria-label="Dismiss"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
        onClick={() => {
          try {
            document.cookie = `${MAIL_PROMPT_COOKIE}=1; Max-Age=${30 * 86400}; Path=/; SameSite=Lax`;
          } catch {
            // cookies blocked: it just comes back next visit
          }
          setOpen(false);
        }}
      >
        <IconX size={20} />
      </button>
    </aside>
  );
}
