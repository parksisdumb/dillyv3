"use client";
import { useActionState, useEffect, useRef, startTransition } from "react";
import type { ActionState } from "@/lib/actions/state";
import { IDLE } from "@/lib/actions/state";
import { btn, cn } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action. Submits via a transition (not the `action` prop) so inputs keep their values
 * when the server says no. Shows the error inline and toasts the success message.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  submitVariant = "primary",
  className,
  onSuccess,
  stickySubmit = false,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "success";
  className?: string;
  onSuccess?: (s: ActionState) => void;
  stickySubmit?: boolean;
  confirm?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const { toast } = useToast();
  const last = useRef<ActionState>(IDLE);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast(state.message);
      onSuccess?.(state);
    }
  }, [state, toast, onSuccess]);

  return (
    <form
      className={cn("flex flex-col gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
    >
      {children}
      {!state.ok && state.error && (
        <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className={cn(stickySubmit && "sticky bottom-0 -mx-4 border-t border-line bg-ground/95 px-4 py-3 backdrop-blur")}>
        <button type="submit" disabled={pending} className={btn(submitVariant, "lg", "w-full")}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
