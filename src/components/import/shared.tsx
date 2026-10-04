"use client";
import { FIELDS, type FieldKey } from "@/lib/domain/import/fields";
import type { AccountType } from "@/lib/domain/vocab";
import { cn, input, labelText } from "@/components/ui/styles";

export type ImportOptions = { defaultOwnerId: string | null; partyRole: "manager" | "owner"; defaultType: AccountType };

/** Wide layout for desktop: breaks out of the app's 768px column on large screens, normal on phones. */
export const wide = "lg:relative lg:left-1/2 lg:w-[min(1180px,calc(100vw-48px))] lg:-translate-x-1/2";

/** Small labeled select used by both steps. */
export function OptSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className={labelText}>{label}</span>
      <select className={cn(input, "appearance-auto")} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const fieldOptions = [
  { value: "", label: "— Don't import —" },
  ...(Object.entries(FIELDS) as [FieldKey, (typeof FIELDS)[FieldKey]][]).map(([k, f]) => ({ value: k, label: f.label })),
];
