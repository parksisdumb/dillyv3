"use client";

import { useEffect, useState } from "react";
import { IconX } from "@/components/icons";
import { shouldShowInstallHint } from "@/lib/push/device";

const KEY = "dilly:install-hint-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One-time, dismissible hint for iOS Safari reps: reminders only reach an iPhone from the home-screen app.
 * Renders nothing on the server and nothing anywhere else.
 */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    const nav = navigator as Navigator & { standalone?: boolean };
    if (!readDismissed() && shouldShowInstallHint(nav, standalone)) setShow(true);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: hide for this visit */
    }
    setShow(false);
  };

  return (
    <aside aria-label="Install Dilly" className="mx-4 mt-3 flex items-start gap-3 rounded-lg border-2 border-accent bg-surface p-3">
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-bold">Add Dilly to your home screen</p>
        <p className="text-sm text-muted">
          Tap <span className="font-semibold text-ink">Share</span>, then <span className="font-semibold text-ink">Add to Home Screen</span>. Reminders
          only reach your iPhone from the home-screen app.
        </p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss install hint" className="-m-1 inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
        <IconX size={20} />
      </button>
    </aside>
  );
}
