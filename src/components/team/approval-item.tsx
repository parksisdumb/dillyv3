"use client";
import { useState } from "react";
import { decideApproval } from "@/lib/actions/approvals";
import { ActionForm } from "@/components/ui/action-form";
import { btn, cn, input, labelText } from "@/components/ui/styles";

/**
 * One-tap Approve; Edit and Reject open a short form (edited JSON / reason).
 * Controls are hidden when the gate needs an owner or admin (RLS enforces it either way).
 */
export function ApprovalItem({ id, payload, canDecide }: { id: string; payload: string; canDecide: boolean }) {
  const [mode, setMode] = useState<"edit" | "reject" | null>(null);
  if (!canDecide) return <p className="mt-2 text-sm text-muted">Needs an owner or admin to decide.</p>;

  if (!mode) {
    return (
      <div className="mt-3 grid grid-cols-3 gap-2">
        <ActionForm action={decideApproval} submitLabel="Approve" submitVariant="success" submitSize="md" className="gap-0">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="approved" />
        </ActionForm>
        <button type="button" onClick={() => setMode("edit")} className={btn("secondary", "md")}>
          Edit
        </button>
        <button type="button" onClick={() => setMode("reject")} className={btn("secondary", "md", "text-danger")}>
          Reject
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border-2 border-line p-3">
      <ActionForm
        action={decideApproval}
        submitLabel={mode === "edit" ? "Approve with edits" : "Reject"}
        submitVariant={mode === "reject" ? "danger" : "primary"}
        submitSize="md"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value={mode === "edit" ? "edited" : "rejected"} />
        {mode === "edit" && (
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Edited version</span>
            <textarea name="edited_payload" defaultValue={payload} rows={8} className={cn(input, "py-2 font-mono text-sm")} />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>
            {mode === "reject" ? "Why" : "Note"}
            {mode === "reject" && <span className="text-accent"> *</span>}
          </span>
          <input name="note" className={input} placeholder={mode === "reject" ? "Wrong contact — Dave left in June" : "Optional"} />
        </label>
      </ActionForm>
      <button type="button" onClick={() => setMode(null)} className={btn("ghost", "md", "mt-2 w-full text-muted")}>
        Cancel
      </button>
    </div>
  );
}
