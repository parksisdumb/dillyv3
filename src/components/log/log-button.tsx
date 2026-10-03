"use client";
import type { LogTarget } from "@/lib/actions/log-types";
import { useLog } from "@/components/log/log-provider";
import { btn, cn } from "@/components/ui/styles";
import { IconLog } from "@/components/icons";

/** Inline "Log" button that opens the sheet with a specific context. */
export function LogButton({
  target,
  label = "Log",
  variant = "secondary",
  size = "md",
  className,
  ariaLabel,
}: {
  ariaLabel?: string;
  target: LogTarget;
  label?: string;
  variant?: "primary" | "accent-outline" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { openLog } = useLog();
  return (
    <button type="button" aria-label={ariaLabel} className={btn(variant, size, className)} onClick={() => openLog(target)}>
      <IconLog size={20} />
      {label}
    </button>
  );
}

/** The always-there orange Log button above the bottom nav. */
export function FloatingLogButton() {
  const { openLog, fabHidden } = useLog();
  if (fabHidden) return null;
  return (
    <button
      type="button"
      onClick={() => openLog()}
      aria-label="Log a touch"
      className={cn(
        "fixed right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-accent px-5 font-display text-xl font-bold text-accent-ink shadow-lg",
        "bottom-[calc(env(safe-area-inset-bottom)+76px)] hover:brightness-110 active:brightness-95",
      )}
    >
      <IconLog size={22} />
      Log
    </button>
  );
}
