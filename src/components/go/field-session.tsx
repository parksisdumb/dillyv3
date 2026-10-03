"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { logTouch } from "@/lib/actions/log";
import { CHANNELS, OUTCOMES, PERSONA_ROLES, QUICK_OUTCOMES, type Channel, type Outcome, type PersonaRole } from "@/lib/domain/vocab";
import { previewPoints, type PointRules } from "@/lib/domain/points";
import { QuickContactForm } from "@/components/log/quick-contact-form";
import { TierPill } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconCheck, IconDirections, IconList, IconPlus, IconSkip } from "@/components/icons";
import { HideLogFab } from "@/components/log/log-provider";
import type { Stop, StopContact } from "@/components/go/types";

const FIELD_CHANNELS: Channel[] = ["site_visit", "door_knock", "roof_walk", "meeting"];

export function FieldSession({ stops: initial, points }: { stops: Stop[]; points: PointRules }) {
  // Snapshot: the server re-renders after each log (revalidatePath); the session keeps its own running order.
  const [stops] = useState(initial);
  const { toast } = useToast();
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({}); // accountId → outcome label
  const [tally, setTally] = useState({ points: 0, stops: 0 });
  const [channel, setChannel] = useState<Channel>("site_visit");
  const [notes, setNotes] = useState("");
  const [notesFocused, setNotesFocused] = useState(false);
  const [moreOutcomes, setMoreOutcomes] = useState(false);
  const [met, setMet] = useState<StopContact | null>(null);
  const [added, setAdded] = useState<Record<string, StopContact[]>>({});
  const [adding, setAdding] = useState(false);
  const [list, setList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (stops.length === 0) {
    return (
      <div className="mx-4 rounded-lg border-2 border-dashed border-line px-4 py-8 text-center">
        <p className="font-display text-xl font-bold">No stops yet</p>
        <p className="mt-1 text-sm text-muted">Accounts assigned to you with an address show up here, grouped by city.</p>
        <Link href="/app/accounts?scope=all&state=not_started" className={btn("primary", "md", "mt-4")}>
          Find accounts
        </Link>
      </div>
    );
  }

  const stop = stops[Math.min(idx, stops.length - 1)];
  const people = [...stop.contacts, ...(added[stop.accountId] ?? [])];
  const remaining = stops.filter((s) => !done[s.accountId]).length;

  const goTo = (i: number) => {
    setIdx(i);
    setNotes("");
    setMet(null);
    setAdding(false);
    setError(null);
    setList(false);
  };
  const nextOpen = (from: number) => {
    for (let k = 1; k <= stops.length; k++) {
      const j = (from + k) % stops.length;
      if (!done[stops[j].accountId]) return j;
    }
    return from;
  };

  const disposition = (outcome: Outcome) =>
    start(async () => {
      setError(null);
      const r = await logTouch({
        accountId: stop.accountId,
        contactId: met?.id ?? null,
        propertyId: stop.propertyId,
        channel,
        outcome,
        notes: notes || null,
        metRole: met && met.role !== "unknown" ? met.role : null,
        source: "field",
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.toast);
      setTally((t) => ({ points: t.points + r.points, stops: t.stops + 1 }));
      const nextDone = { ...done, [stop.accountId]: OUTCOMES[outcome].label };
      setDone(nextDone);
      const j = stops.findIndex((s, k) => k > idx && !nextDone[s.accountId]);
      const wrap = stops.findIndex((s) => !nextDone[s.accountId]);
      if (j >= 0) goTo(j);
      else if (wrap >= 0) goTo(wrap);
    });

  return (
    <div className="px-4">
      <HideLogFab />
      {/* Tally */}
      <div className="flex min-h-14 items-center gap-3 rounded-lg bg-strong pl-4 pr-2 text-strong-ink">
        <span className="num font-display text-2xl font-extrabold">+{tally.points}</span>
        <span className="num min-w-0 flex-1 truncate text-sm opacity-80">
          {tally.stops} logged · {remaining} to go
        </span>
        <button type="button" onClick={() => setList((l) => !l)} className="label inline-flex min-h-12 shrink-0 items-center gap-1 px-2 text-xs hover:underline">
          <IconList size={16} /> {list ? "Back to stop" : `All ${stops.length}`}
        </button>
      </div>

      {list ? (
        <ol className="mt-3 divide-y divide-line rounded-lg border-2 border-line bg-surface">
          {stops.map((s, i) => (
            <li key={s.accountId}>
              <button type="button" onClick={() => goTo(i)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                <span className="num w-6 font-display font-bold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.accountName}</span>
                  <span className="block truncate text-sm text-muted">{s.address ?? s.city}</span>
                </span>
                {done[s.accountId] ? <span className="label text-xs text-success">{done[s.accountId]}</span> : s.fromQueue && <span className="label text-xs text-accent">Due</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <article className="mt-3" aria-label={`Stop ${idx + 1} of ${stops.length}`}>
          <div className="label text-xs text-muted">
            Stop {idx + 1} of {stops.length}
            {done[stop.accountId] && <span className="ml-2 text-success">· Logged: {done[stop.accountId]}</span>}
          </div>
          <div className="mt-1 flex items-start gap-2">
            <TierPill tier={stop.tier} />
            <h2 className="min-w-0 flex-1 font-display text-2xl font-bold leading-tight">{stop.accountName}</h2>
          </div>
          {stop.place && <div className="mt-1 font-semibold">{stop.place}</div>}
          <div className="text-base text-muted">{[stop.address, stop.city].filter(Boolean).join(", ")}</div>
          {stop.reason && <div className="mt-1 text-sm">{stop.reason}</div>}

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            {stop.directions ? (
              <a href={stop.directions} target="_blank" rel="noreferrer" className={btn("secondary", "lg")}>
                <IconDirections size={22} /> Directions
              </a>
            ) : (
              <span className={btn("secondary", "lg", "opacity-50")}>No address</span>
            )}
            <button type="button" onClick={() => goTo(nextOpen(idx))} className={btn("secondary", "lg")} aria-label="Skip to next stop">
              <IconSkip size={22} /> Skip
            </button>
          </div>

          {/* Who I met */}
          <section className="mt-4">
            <div className={labelText}>Who I met</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={met?.id === p.id}
                  onClick={() => setMet(met?.id === p.id ? null : p)}
                  className={cn(
                    "min-h-12 rounded-lg border-2 px-3 text-left text-sm",
                    met?.id === p.id ? "border-ink bg-ink text-ground" : "border-line bg-surface",
                  )}
                >
                  <span className="block font-semibold">{p.name}</span>
                  <span className={cn("block text-xs", met?.id === p.id ? "text-ground/70" : "text-muted")}>
                    {p.title ?? PERSONA_ROLES[p.role as PersonaRole] ?? ""}
                  </span>
                </button>
              ))}
              <button type="button" onClick={() => setAdding(true)} className={btn("secondary", "md", "border-dashed")}>
                <IconPlus size={18} /> Add person I met
              </button>
            </div>
            {adding && (
              <div className="mt-3 rounded-lg border-2 border-line bg-surface p-3">
                <QuickContactForm
                  accountId={stop.accountId}
                  propertyId={stop.propertyId}
                  source="field"
                  submitLabel="Add person"
                  onCancel={() => setAdding(false)}
                  onDone={(c, created) => {
                    const sc = { id: c.id, name: c.name, title: c.title, role: c.persona_role };
                    if (!people.some((p) => p.id === c.id)) setAdded((m) => ({ ...m, [stop.accountId]: [...(m[stop.accountId] ?? []), sc] }));
                    setMet(sc);
                    setAdding(false);
                    toast(created ? `Added ${c.name}` : `Using ${c.name}`);
                  }}
                />
              </div>
            )}
          </section>

          {/* How */}
          <div className="mt-4 grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Visit type">
            {FIELD_CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                onClick={() => setChannel(c)}
                className={cn("min-h-12 rounded-md px-1 text-sm font-semibold leading-tight", channel === c ? "bg-ink text-ground" : "text-ink")}
              >
                {CHANNELS[c].label}
              </button>
            ))}
          </div>

          <label className="mt-3 flex flex-col gap-1.5">
            <span className={labelText}>Notes</span>
            <textarea
              className={cn(input, "py-2")}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onFocus={() => setNotesFocused(true)}
              onBlur={() => setTimeout(() => setNotesFocused(false), 200)}
              placeholder="Chief engineer is Dave, back Thu. 2009 TPO, ponding west side."
            />
          </label>

          {/* Dispositions: sticky tray above the bottom nav so the decision is always one thumb away.
              Drops back into normal flow while Notes is focused so it never covers the field under the keyboard. */}
          <div
            className={cn(
              "z-10 -mx-4 mt-4 border-t border-line bg-ground px-4 pb-2 pt-2",
              !notesFocused && "sticky bottom-[calc(env(safe-area-inset-bottom)+64px)]",
            )}
            role="group"
            aria-label="What happened"
          >
            <div className="label mb-1.5 flex items-center justify-between text-xs text-muted">
              <span>
                What happened · {CHANNELS[channel].label}
                {met && <> · {met.name}</>}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(moreOutcomes ? QUICK_OUTCOMES[channel] : QUICK_OUTCOMES[channel].slice(0, 4)).map((o) => {
                const tone = OUTCOMES[o].tone;
                return (
                  <button
                    key={o}
                    type="button"
                    disabled={pending}
                    onClick={() => disposition(o)}
                    className={cn(
                      "flex min-h-14 flex-col items-start justify-center rounded-lg border-2 px-3 text-left disabled:opacity-50",
                      tone === "great" ? "border-accent bg-accent text-accent-ink" : tone === "bad" ? "border-line bg-surface text-danger" : "border-ink bg-surface",
                    )}
                  >
                    <span className="font-display text-base font-bold leading-tight">{OUTCOMES[o].label}</span>
                    <span className={cn("num label text-xs", tone === "great" ? "opacity-80" : "text-muted")}>
                      +{previewPoints(channel, o, met && met.role !== "unknown" ? (met.role as PersonaRole) : null, points)}
                    </span>
                  </button>
                );
              })}
            </div>
            {QUICK_OUTCOMES[channel].length > 4 && (
              <button type="button" onClick={() => setMoreOutcomes((m) => !m)} className={btn("ghost", "sm", "mt-1 w-full text-muted")} aria-expanded={moreOutcomes}>
                {moreOutcomes ? "Fewer" : `More (${QUICK_OUTCOMES[channel].length - 4})`}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {remaining === 0 && (
            <p className="mt-4 flex items-center gap-2 rounded-lg border-2 border-success px-3 py-3 font-semibold text-success">
              <IconCheck /> Every stop logged. +{tally.points} today from the field.
            </p>
          )}
        </article>
      )}
    </div>
  );
}
