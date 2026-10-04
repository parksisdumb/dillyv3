"use client";

import { btn } from "@/components/ui/styles";

/** Reloads the screen the rep was trying to open (the offline page is served at that URL). */
export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => (window.location.pathname === "/offline" ? window.location.assign("/app/today") : window.location.reload())}
      className={btn("primary", "lg", "mt-6 w-full")}
    >
      Try again
    </button>
  );
}
