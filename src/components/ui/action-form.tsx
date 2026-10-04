"use client";
import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/lib/actions/state";
import { IDLE } from "@/lib/actions/state";
import { btn, cn } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action. Submits via a transition (not the `action` prop) so inputs keep their values
 * when the server says no. Shows the error inline and toasts the success message.
 *
 * Why not useActionState: its pending flag is tied to the action's transition, and when the action revalidates
 * (every save here does `revalidatePath("/app", "layout")`) that transition is entangled with the router's own
 * update for the response. Under React 19.1 / Next 15.5 the router update intermittently never commits, leaving
 * the button on "Saving…" forever although the save succeeded (BUGS.md B1). Calling the action from our own
 * `useTransition` — the pattern Today's Done/Snooze/Drop and the Log sheet always used — doesn't hang.
 * The toast fires from the submit handler, not an effect, so it shows even when the form unmounts on success
 * (an approved item leaving the list, a won job closing its forms).
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
  submitSize = "lg",
}: {
  submitSize?: "md" | "lg";
  action: Action;
  children: React.ReactNode;
  submitLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "success";
  className?: string;
  onSuccess?: (s: ActionState) => void;
  stickySubmit?: boolean;
  confirm?: string;
}) {
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const prev = useRef<ActionState>(IDLE);

  return (
    <form
      className={cn("flex flex-col gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        start(async () => {
          // An action that ends in redirect() navigates away and may resolve with nothing.
          let r: ActionState;
          try {
            r = (await action(prev.current, fd)) ?? IDLE;
          } catch (err) {
            // redirect() is delivered as navigation, not a throw; a throw here is a lost connection or outage.
            if (err instanceof Error && /NEXT_REDIRECT/.test(err.message)) throw err;
            r = { ok: false, error: "Couldn't save — can't reach the server. Check your signal and try again." };
          }
          prev.current = r;
          setState(r);
          if (r.ok) {
            if (r.message) toast(r.message);
            onSuccess?.(r);
          }
        });
      }}
    >
      {children}
      {!state.ok && state.error && (
        <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className={cn(stickySubmit && "sticky bottom-0 -mx-4 border-t border-line bg-ground/95 px-4 py-3 backdrop-blur")}>
        <button type="submit" disabled={pending} className={btn(submitVariant, submitSize, "w-full")}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
