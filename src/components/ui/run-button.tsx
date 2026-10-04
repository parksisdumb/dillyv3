"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { btn } from "@/components/ui/styles";

type Result = { ok: boolean; error?: string; message?: string };

/** One-tap server action (pass a bound action): optional confirm, toast, refresh. */
export function RunButton({
  action,
  label,
  pendingLabel = "Working…",
  confirm,
  variant = "secondary",
  size = "md",
  className,
  then,
}: {
  action: () => Promise<Result>;
  label: React.ReactNode;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent-outline";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Navigate here on success instead of refreshing. */
  then?: string;
}) {
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className={btn(variant, size, className)}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          let r: Result;
          try {
            r = await action();
          } catch {
            r = { ok: false, error: "Couldn't save — can't reach the server." };
          }
          if (!r.ok) {
            toast(r.error ?? "Couldn't do that.", "bad");
            return;
          }
          if (r.message) toast(r.message);
          if (then) router.push(then);
          else router.refresh();
        });
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
