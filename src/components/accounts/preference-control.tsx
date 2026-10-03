"use client";
import { useState } from "react";
import { setPreference } from "@/lib/actions/accounts";
import { PREFERENCES, type Preference } from "@/lib/domain/vocab";
import { ActionForm } from "@/components/ui/action-form";
import { cn, input, labelText } from "@/components/ui/styles";

const KEYS = Object.keys(PREFERENCES) as Preference[];

/** Pursue / Deprioritize / Do not pursue / Competitor / Existing client / Partner — with a reason. */
export function PreferenceControl({ accountId, preference, reason }: { accountId: string; preference: string | null; reason: string | null }) {
  const [sel, setSel] = useState<Preference | "none">((preference as Preference) ?? "none");
  const needsReason = sel === "do_not_pursue" || sel === "competitor";
  const dirty = sel !== ((preference as Preference) ?? "none");

  return (
    <ActionForm action={setPreference} submitLabel={sel === "none" ? "Clear preference" : `Save · ${PREFERENCES[sel].label}`} submitVariant={dirty ? "primary" : "secondary"}>
      <input type="hidden" name="account_id" value={accountId} />
      <fieldset>
        <legend className={labelText}>How we treat this account</legend>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
          {KEYS.map((k) => (
            <label
              key={k}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-md px-1 text-center text-sm font-semibold leading-tight has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus",
                sel === k ? (k === "do_not_pursue" || k === "competitor" ? "bg-danger text-white" : "bg-ink text-ground") : "text-ink hover:bg-surface",
              )}
            >
              <input type="radio" name="preference" value={k} checked={sel === k} onChange={() => setSel(k)} className="sr-only" />
              {PREFERENCES[k].label}
            </label>
          ))}
        </div>
        <label className={cn("mt-2 flex min-h-12 items-center gap-2 text-sm", sel === "none" ? "text-ink" : "text-muted")}>
          <input type="radio" name="preference" value="none" checked={sel === "none"} onChange={() => setSel("none")} className="size-5" />
          No preference (rank normally)
        </label>
        <p className="mt-1 text-sm text-muted">{sel === "none" ? "Ranked by tier, portfolio and targeting." : PREFERENCES[sel].hint}</p>
      </fieldset>
      {sel !== "none" && (
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>
            Reason{needsReason && <span className="text-accent"> *</span>}
          </span>
          <input name="reason" defaultValue={reason ?? ""} className={input} placeholder={needsReason ? "Pays late · uses in-house crew" : "Optional"} required={needsReason} />
        </label>
      )}
    </ActionForm>
  );
}
