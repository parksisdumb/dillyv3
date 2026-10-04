"use client";
import { useState, useTransition } from "react";
import { completeTask, dropTask, snoozeTask } from "@/lib/actions/tasks";
import { MAX_SNOOZES } from "@/lib/domain/tasks";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input } from "@/components/ui/styles";
import { IconCheck, IconClock, IconX } from "@/components/icons";
import type { ActionState } from "@/lib/actions/state";

/** Done / Snooze / Drop for a queue task. After 3 snoozes, Snooze becomes "drop or do-not-pursue". */
export function TaskActions({ taskId, snoozeCount, hasAccount }: { taskId: string; snoozeCount: number; hasAccount: boolean }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [deciding, setDeciding] = useState(false);
  const [reason, setReason] = useState("");
  const worn = snoozeCount >= MAX_SNOOZES;

  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast(r.message ?? "Saved");
      else toast(r.error ?? "Didn't work", "bad");
    });

  if (deciding) {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-lg border-2 border-warning p-3">
        <p className="text-sm font-semibold">
          {worn ? `Snoozed ${snoozeCount} times. ` : ""}Drop it, or take the account off the list?
        </p>
        {hasAccount && (
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (e.g. pays late, uses in-house crew)" />
        )}
        <div className={cn("grid gap-2", hasAccount ? "grid-cols-3" : "grid-cols-2")}>
          <button type="button" className={btn("secondary", "sm")} onClick={() => setDeciding(false)}>
            Keep
          </button>
          <button type="button" disabled={pending} className={btn("secondary", "sm")} onClick={() => run(() => dropTask({ taskId }))}>
            Drop
          </button>
          {hasAccount && (
            <button
              type="button"
              disabled={pending}
              className={btn("danger", "sm")}
              onClick={() => run(() => dropTask({ taskId, doNotPursue: true, reason: reason || undefined }))}
            >
              Not pursuing
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      <button type="button" disabled={pending} className={btn("secondary", "sm")} onClick={() => run(() => completeTask(taskId))}>
        <IconCheck size={18} /> Done
      </button>
      <button
        type="button"
        disabled={pending}
        className={btn("secondary", "sm")}
        onClick={() => (worn ? setDeciding(true) : run(() => snoozeTask(taskId)))}
        title={worn ? "Snoozed 3 times" : "Move to next business day"}
      >
        <IconClock size={18} /> {worn ? "Decide" : "Snooze"}
      </button>
      <button type="button" disabled={pending} className={btn("secondary", "sm")} onClick={() => setDeciding(true)}>
        <IconX size={18} /> Drop
      </button>
    </div>
  );
}
