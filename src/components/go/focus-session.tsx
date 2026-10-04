"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { isQueued, useLogTouch } from "@/components/log/use-log-touch";
import { OUTCOMES, QUICK_OUTCOMES, type Outcome } from "@/lib/domain/vocab";
import { CONNECT_OUTCOMES, previewPoints, type PointRules } from "@/lib/domain/points";
import { TierPill } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input } from "@/components/ui/styles";
import { IconPhone, IconSkip } from "@/components/icons";
import { HideLogFab } from "@/components/log/log-provider";
import type { FocusItem } from "@/components/go/types";

/** Dial queue: one contact at a time, outcome buttons with their point values, running tally. */
export function FocusSession({ items: initial, points }: { items: FocusItem[]; points: PointRules }) {
  // Snapshot: the server re-renders after each log (revalidatePath); the session keeps its own running order.
  const [items] = useState(initial);
  const { toast } = useToast();
  const [idx, setIdx] = useState(0);
  const [tally, setTally] = useState({ points: 0, calls: 0, connects: 0 });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const logTouch = useLogTouch(); // idempotent + never throws on lost signal

  if (items.length === 0) {
    return (
      <div className="mx-4 rounded-lg border-2 border-dashed border-line px-4 py-8 text-center">
        <p className="font-display text-xl font-bold">No calls queued</p>
        <p className="mt-1 text-sm text-muted">Queue items with a phone number land here. Add numbers to your contacts to fill it.</p>
        <Link href="/app/go" className={btn("primary", "md", "mt-4")}>
          Go in person instead
        </Link>
      </div>
    );
  }

  const finished = idx >= items.length;
  const it = items[Math.min(idx, items.length - 1)];

  const next = () => {
    setIdx((i) => i + 1);
    setNotes("");
    setError(null);
  };

  const log = (outcome: Outcome) =>
    start(async () => {
      setError(null);
      const r = await logTouch(
        {
          accountId: it.accountId,
          contactId: it.contactId,
          propertyId: it.propertyId,
          opportunityId: it.opportunityId,
          channel: "call",
          outcome,
          notes: notes || null,
        },
        {
          label: `Call · ${OUTCOMES[outcome].label} · ${it.name}`,
          href: it.contactId ? `/app/contacts/${it.contactId}` : it.accountId ? `/app/accounts/${it.accountId}` : null,
        },
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.toast, isQueued(r) ? "neutral" : "good");
      setTally((t) => ({
        points: t.points + r.points,
        calls: t.calls + 1,
        connects: t.connects + (CONNECT_OUTCOMES.includes(outcome) ? 1 : 0),
      }));
      next();
    });

  return (
    <div className="px-4">
      <HideLogFab />
      <div className="grid grid-cols-3 rounded-lg bg-strong px-4 py-2 text-strong-ink">
        {[
          ["Points", `+${tally.points}`],
          ["Dials", tally.calls],
          ["Connects", tally.connects],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="label text-xs opacity-70">{k}</div>
            <div className="num font-display text-2xl font-extrabold leading-tight">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full bg-accent motion-safe:transition-[width]" style={{ width: `${Math.round((Math.min(idx, items.length) / items.length) * 100)}%` }} />
      </div>

      {finished ? (
        <div className="mt-4 rounded-lg border-2 border-success px-4 py-6 text-center">
          <p className="font-display text-2xl font-bold">Session done</p>
          <p className="num mt-1 text-base">
            {tally.calls} dials · {tally.connects} connects · +{tally.points} points
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" className={btn("secondary", "md")} onClick={() => setIdx(0)}>
              Run it again
            </button>
            <Link href="/app/today" className={btn("primary", "md")}>
              Back to Today
            </Link>
          </div>
        </div>
      ) : (
        <article className="mt-4" aria-label={`Call ${idx + 1} of ${items.length}`}>
          <div className="label text-xs text-muted">
            Call {idx + 1} of {items.length}
          </div>
          <div className="mt-1 flex items-start gap-2">
            <TierPill tier={it.tier} />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-2xl font-bold leading-tight">{it.name}</h2>
              {it.account && <div className="text-base text-muted">{it.account}</div>}
            </div>
          </div>
          {it.reason && <p className="mt-2 text-base">{it.reason}</p>}

          <a href={`tel:${it.phone}`} className={btn("primary", "lg", "mt-4 w-full text-2xl")}>
            <IconPhone size={24} /> <span className="num">{it.phone}</span>
          </a>

          <textarea className={cn(input, "mt-3 py-2")} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" />

          <div className="mt-3 grid grid-cols-2 gap-2">
            {QUICK_OUTCOMES.call.map((o) => {
              const tone = OUTCOMES[o].tone;
              return (
                <button
                  key={o}
                  type="button"
                  disabled={pending}
                  onClick={() => log(o)}
                  className={cn(
                    "flex min-h-16 flex-col items-start justify-center rounded-lg border-2 px-3 py-2 text-left disabled:opacity-50",
                    tone === "great" ? "border-accent bg-accent text-accent-ink" : tone === "bad" ? "border-line bg-surface text-danger" : "border-ink bg-surface",
                  )}
                >
                  <span className="font-display text-base font-bold leading-tight">{OUTCOMES[o].label}</span>
                  <span className={cn("num font-display text-base font-extrabold", tone === "great" ? "" : "text-accent")}>+{previewPoints("call", o, null, points)}</span>
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="button" onClick={next} className={btn("ghost", "md", "mt-2 w-full text-muted")}>
            <IconSkip size={18} /> Skip
          </button>
        </article>
      )}
    </div>
  );
}
