"use client";
// One-tap condition flags (leak, ponding, damage…). Optimistic; the server keeps history (cleared_at).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPropertyFlag } from "@/lib/actions/ownership";
import { PROPERTY_FLAGS, type PropertyFlag } from "@/lib/domain/badges-property";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/styles";
import { BADGE_ICONS } from "@/components/accounts/property-badges";

const FIELD_LABEL: Partial<Record<PropertyFlag, string>> = { active_leak: "Leak", ponding: "Ponding", membrane_damage: "Damage" };

export function ConditionToggles({
  propertyId,
  active,
  flags,
  size = "md",
  className,
  label = "Condition",
  collapsed,
}: {
  propertyId: string;
  active: string[];
  flags: PropertyFlag[];
  size?: "md" | "lg";
  className?: string;
  label?: string;
  /** Show only this many (plus any that are on) until "More" is tapped. */
  collapsed?: number;
}) {
  const [all, setAll] = useState(false);
  const [on, setOn] = useState<Set<string>>(() => new Set(active));
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const toggle = (f: PropertyFlag) => {
    const next = !on.has(f);
    setOn((s) => {
      const n = new Set(s);
      if (next) n.add(f);
      else n.delete(f);
      return n;
    });
    setBusy(f);
    start(async () => {
      const r = await setPropertyFlag({ propertyId, flag: f, on: next });
      setBusy(null);
      if (!r.ok) {
        setOn((s) => {
          const n = new Set(s);
          if (next) n.delete(f);
          else n.add(f);
          return n;
        });
        toast(r.error, "bad");
        return;
      }
      toast(r.message);
      router.refresh();
    });
  };

  return (
    <div className={className} role="group" aria-label={label}>
      <div className={cn("flex gap-2", size === "lg" ? "grid grid-cols-3" : "flex-wrap")}>
        {flags
          .filter((f, i) => all || collapsed == null || i < collapsed || on.has(f))
          .map((f) => {
          const d = PROPERTY_FLAGS[f];
          const Icon = BADGE_ICONS[d.icon];
          const pressed = on.has(f);
          const danger = d.tone === "bad";
          return (
            <button
              key={f}
              type="button"
              aria-pressed={pressed}
              disabled={busy === f}
              onClick={() => toggle(f)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border-2 font-semibold transition-colors disabled:opacity-60",
                size === "lg" ? "min-h-14 flex-col justify-center px-1 text-sm leading-tight" : "min-h-12 px-3 text-sm",
                pressed
                  ? danger
                    ? "border-danger bg-danger text-white"
                    : "border-ink bg-ink text-ground"
                  : "border-line bg-surface text-ink hover:border-ink",
              )}
            >
              <Icon size={size === "lg" ? 22 : 18} className={cn("shrink-0", !pressed && (danger ? "text-danger" : "text-warning"))} />
              <span>{size === "lg" ? (FIELD_LABEL[f] ?? d.label) : d.long}</span>
            </button>
          );
        })}
        {collapsed != null && !all && flags.length > collapsed && (
          <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-12 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-surface-2">
            More…
          </button>
        )}
      </div>
    </div>
  );
}
