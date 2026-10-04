"use client";
import Link from "next/link";
import { useState } from "react";
import { useOfflineQueue, queuedLabel } from "@/components/offline/offline-queue";
import { Sheet } from "@/components/ui/sheet";
import { btn, cn } from "@/components/ui/styles";
import { IconAlert, IconNoSignal } from "@/components/icons";
import { timeOfDay } from "@/lib/format";

/**
 * Top-bar strip (under the company row, so it never squeezes the name off a 390 px phone):
 * "Waiting for signal · 2 queued" / "Sending · 2 queued" / "1 log to fix". Tap → the queue.
 */
export function QueuePill() {
  const q = useOfflineQueue();
  const [open, setOpen] = useState(false);
  if (!q || (q.pending === 0 && q.failed.length === 0)) return null;
  const failed = q.failed.length;
  const text = q.pending ? (q.sending && q.online ? `Sending · ${q.pending} queued` : queuedLabel(q.pending)) : `${failed} log${failed === 1 ? "" : "s"} to fix`;
  return (
    <div className={cn("border-t", failed && !q.pending ? "border-danger/40 bg-danger/10" : "border-warning/50 bg-warning/15")}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="queue-pill"
        className={cn(
          "mx-auto flex min-h-9 w-full max-w-3xl items-center justify-center gap-1.5 px-4 text-sm font-semibold",
          failed && !q.pending ? "text-danger" : "text-ink",
        )}
        aria-label={`${text}. Show queued logs`}
      >
        {failed && !q.pending ? <IconAlert size={16} className="shrink-0" /> : <IconNoSignal size={16} className="shrink-0" />}
        <span className="num truncate">{text}</span>
        {failed > 0 && q.pending > 0 && <span className="num shrink-0 text-danger">· {failed} to fix</span>}
        <span className="label ml-1 shrink-0 text-xs text-accent">View</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Saved on this phone" labelledBy="queue-sheet">
        <div className="px-4 pb-2 pt-3 text-sm text-muted">
          {q.pending > 0
            ? "These logs are safe on this phone and send by themselves when you have signal — in the order you made them. Points land when they send."
            : "These logs didn't go through. Fix the record and try again, or discard."}
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {q.items.map((i) => (
            <li key={i.key} className="px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{i.label}</span>
                <span className="num shrink-0 text-xs text-muted">{timeOfDay(i.createdAt)}</span>
              </div>
              <div className="text-sm text-muted">
                {i.status === "failed" ? <span className="text-danger">{i.error ?? "Didn't go through."}</span> : "Waiting for signal"}
                {i.photos.length > 0 && <> · {i.photos.length} photo{i.photos.length === 1 ? "" : "s"}</>}
              </div>
              {i.status === "failed" && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button type="button" className={btn("primary", "sm")} onClick={() => void q.retry(i.key)}>
                    Try again
                  </button>
                  {i.href ? (
                    <Link href={i.href} onClick={() => setOpen(false)} className={btn("secondary", "sm")}>
                      Open
                    </Link>
                  ) : (
                    <span />
                  )}
                  <button type="button" className={btn("danger", "sm")} onClick={() => void q.discard(i.key)}>
                    Discard
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {q.pending > 0 && (
          <div className="p-4">
            <button type="button" className={btn("secondary", "md", "w-full")} onClick={q.replayNow} disabled={!q.online || q.sending}>
              {q.sending ? "Sending…" : q.online ? "Send now" : "No signal yet"}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
