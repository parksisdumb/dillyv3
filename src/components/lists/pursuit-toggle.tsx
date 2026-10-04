"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPursuit } from "@/lib/actions/lists";
import { useToast } from "@/components/ui/toast";
import { btn, cn } from "@/components/ui/styles";
import { IconTarget } from "@/components/icons";

/**
 * "Mark active" ⇄ "Active". Detail pages use the full button; rows and Go stops use `compact` (icon + short label).
 * Optimistic: flips at once, rolls back with an error toast if the server says no.
 */
export function PursuitToggle({
  propertyId,
  active: initial,
  name,
  compact = false,
  className,
}: {
  propertyId: string;
  active: boolean;
  name?: string;
  compact?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState(initial);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const label = active ? "Active" : compact ? "Active?" : "Mark active";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `${name ?? "Property"} is active — tap to stop` : `Mark ${name ?? "property"} active`}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !active;
        setActive(next);
        start(async () => {
          let r: Awaited<ReturnType<typeof setPursuit>>;
          try {
            r = await setPursuit({ propertyIds: [propertyId], status: next ? "active" : "dropped" });
          } catch {
            r = { ok: false, error: "Couldn't save — can't reach the server." };
          }
          if (!r.ok) {
            setActive(!next);
            toast(r.error, "bad");
            return;
          }
          toast(r.message);
          router.refresh();
        });
      }}
      className={cn(
        compact
          ? "label inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1 rounded-lg border-2 px-2 text-xs"
          : btn(active ? "primary" : "accent-outline", "md"),
        compact && (active ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-muted"),
        className,
      )}
    >
      <IconTarget size={compact ? 16 : 20} />
      <span>{label}</span>
    </button>
  );
}
