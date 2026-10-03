"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/styles";
import { IconX } from "@/components/icons";

/**
 * Bottom sheet on a native <dialog>: focus trap, Escape and backdrop tap close it, and when closed nothing
 * stays on top of the page (the old app's menu overlay swallowed taps — this can't).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // tap on backdrop
      }}
      className={cn(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl border-0 bg-surface p-0 text-ink shadow-2xl",
        "sm:mx-auto sm:mb-auto sm:max-w-lg sm:rounded-2xl",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex min-h-14 items-center gap-2 border-b border-line px-4">
            <div className="min-w-0 flex-1 font-display text-xl font-bold" id={labelledBy}>
              {title}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 inline-flex size-12 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Close">
              <IconX />
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),16px)]">{children}</div>
        </div>
      )}
    </dialog>
  );
}
