"use client";
import { useState } from "react";
import { decideApproval } from "@/lib/actions/approvals";
import { ActionForm } from "@/components/ui/action-form";
import { btn, cn, input, labelText } from "@/components/ui/styles";

/** Approve / edit / reject one pending approval. Hidden decide controls when the gate needs an owner/admin. */
export function ApprovalItem({ id, payload, canDecide }: { id: string; payload: string; canDecide: boolean }) {
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  if (!canDecide) return <p className="mt-2 text-sm text-muted">Needs an owner or admin to decide.</p>;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-2">
        {(["view", "edit", "reject"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn(btn("secondary", "sm"), mode === m && "border-ink bg-ink text-ground hover:border-ink")}
          >
            {m === "view" ? "Approve" : m === "edit" ? "Edit" : "Reject"}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <ActionForm
          action={decideApproval}
          submitLabel={mode === "view" ? "Approve as is" : mode === "edit" ? "Approve with edits" : "Reject"}
          submitVariant={mode === "reject" ? "danger" : mode === "edit" ? "primary" : "success"}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value={mode === "view" ? "approved" : mode === "edit" ? "edited" : "rejected"} />
          {mode === "edit" && (
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Edited version</span>
              <textarea name="edited_payload" defaultValue={payload} rows={8} className={cn(input, "py-2 font-mono text-sm")} />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Note{mode === "reject" && <span className="text-accent"> *</span>}</span>
            <input name="note" className={input} placeholder={mode === "reject" ? "Wrong contact — Dave left in June" : "Optional"} />
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
