"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadScheduleContext, saveAppointment, searchScheduleProperties } from "@/lib/actions/appointments";
import type { ApptCard, ScheduleContext, ScheduleProperty, ScheduleTarget } from "@/lib/appointments/types";
import { APPT_KINDS, APPT_KIND_KEYS, DURATIONS, REMINDERS, durationLabel, reminderLabel, suggestTitle, type ApptKind } from "@/lib/domain/appointments";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconCheck, IconSearch } from "@/components/icons";

type Props = {
  open: boolean;
  onClose: () => void;
  target: ScheduleTarget;
  /** Edit / reschedule this appointment (pre-filled from `existing`). */
  existing?: ApptCard | null;
  /** Dev preview: skip the server load. */
  initial?: ScheduleContext;
  onSaved?: (id: string) => void;
};

/**
 * Schedule an inspection / roof walk / meeting… for one building or a series. Kind chips → date + time (native
 * pickers, 15-minute steps) → buildings (the account's, multi-select, + search) → who's attending → notes.
 * Creating it logs nothing; the rep logs the outcome afterwards.
 */
export function ScheduleSheet({ open, onClose, target, existing, initial, onSaved }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [ctx, setCtx] = useState<ScheduleContext | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<ApptKind>(existing?.kind ?? "inspection");
  const [date, setDate] = useState(existing?.date ?? initial?.defaultDate ?? "");
  const [time, setTime] = useState(existing?.time ?? initial?.defaultTime ?? "09:00");
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [duration, setDuration] = useState<number>(
    existing?.endsAt ? Math.max(15, Math.round((Date.parse(existing.endsAt) - Date.parse(existing.startsAt)) / 60000)) : APPT_KINDS[existing?.kind ?? "inspection"].minutes,
  );
  const [props, setProps] = useState<string[]>(existing?.stops.map((s) => s.propertyId) ?? initial?.preselectedPropertyIds ?? []);
  const [people, setPeople] = useState<string[]>(initial?.preselectedContactIds ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!existing);
  const [assignee, setAssignee] = useState<string>(existing?.assignedUserId ?? "");
  const [reminder, setReminder] = useState<number>(existing?.reminderMinutes ?? 60);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ScheduleProperty[]>([]);
  const [extra, setExtra] = useState<ScheduleProperty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || initial) return;
    let live = true;
    loadScheduleContext(target, existing?.id ?? null)
      .then((c) => {
        if (!live) return;
        setCtx(c);
        if (!existing) {
          setDate(c.defaultDate);
          setTime(c.defaultTime);
          setProps(c.preselectedPropertyIds);
        }
        setPeople(c.preselectedContactIds);
        setAssignee((a) => a || c.meId);
      })
      .catch(() => live && setLoadError("Couldn't load. Check signal and try again."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open (the parent remounts per open)
  }, [open]);

  // Search other buildings (another owner, or one not linked yet).
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void searchScheduleProperties(q)
        .then((r) => live && setHits(r))
        .catch(() => live && setHits([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const allProps = useMemo(() => {
    const list = [...(ctx?.properties ?? []), ...extra];
    return list.filter((p, i) => list.findIndex((x) => x.id === p.id) === i);
  }, [ctx, extra]);
  const propName = (id: string) => allProps.find((p) => p.id === id)?.label ?? null;
  const place = ctx?.account?.name ?? (props[0] ? propName(props[0]) : null);
  const autoTitle = suggestTitle(kind, place, props.length);
  const shownTitle = titleTouched ? title : autoTitle;

  // Attendees: people linked to the selected buildings first, then the rest of the account.
  const contacts = useMemo(() => {
    const cs = ctx?.contacts ?? [];
    const near = (c: (typeof cs)[number]) => c.propertyIds.some((p) => props.includes(p));
    return [...cs].sort((a, b) => Number(near(b)) - Number(near(a)));
  }, [ctx, props]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = () => {
    if (!date) return setError("Pick a date.");
    if (!allDay && !time) return setError("Pick a time.");
    setError(null);
    start(async () => {
      const r = await saveAppointment({
        id: existing?.id ?? null,
        kind,
        title: shownTitle,
        date,
        time: allDay ? null : time,
        allDay,
        durationMinutes: allDay ? null : duration,
        propertyIds: props,
        contactIds: people,
        accountId: ctx?.account?.id ?? target.accountId ?? null,
        opportunityId: target.opportunityId ?? null,
        notes: notes || null,
        assignedUserId: assignee || null,
        reminderMinutes: reminder,
        location: existing && existing.stops[0]?.propertyId === props[0] ? existing.location : null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.points > 0 ? `${r.message} · +${r.points}` : r.message);
      onSaved?.(r.id);
      onClose();
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title={existing ? "Edit appointment" : "Schedule"} labelledBy="schedule-sheet-title">
      {loadError && <p className="m-4 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">{loadError}</p>}
      {!ctx && !loadError && <p className="label p-6 text-center text-sm text-muted">Loading…</p>}
      {ctx && (
        <div className="flex flex-col gap-5 px-4 pt-4" data-testid="schedule-sheet">
          <section aria-label="What">
            <div className={cn(labelText, "mb-2")}>What</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Appointment type">
              {APPT_KIND_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => {
                    setKind(k);
                    if (!existing) setDuration(APPT_KINDS[k].minutes);
                  }}
                  className={cn("min-h-12 rounded-full border-2 px-4 text-sm font-semibold", kind === k ? "border-ink bg-ink text-ground" : "border-line bg-surface")}
                >
                  {APPT_KINDS[k].label}
                </button>
              ))}
            </div>
          </section>

          <section aria-label="When" className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={labelText}>Date</span>
                <input className={input} type="date" value={date} min={existing ? undefined : ctx.today} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelText}>Time</span>
                <input className={input} type="time" step={900} value={time} disabled={allDay} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={labelText}>How long</span>
                <select className={input} value={duration} disabled={allDay} onChange={(e) => setDuration(Number(e.target.value))}>
                  {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((m) => (
                    <option key={m} value={m}>
                      {durationLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-12 items-center gap-2 self-end">
                <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                <span className="text-sm">All day</span>
              </label>
            </div>
            <p className="text-xs text-muted">Times are {ctx.timeZone.replace(/_/g, " ").replace(/^America\//, "")} time.</p>
          </section>

          <section aria-label="Buildings">
            <div className={cn(labelText, "mb-2")}>
              Buildings{props.length > 0 && <> · {props.length} picked</>}
            </div>
            {allProps.length > 0 ? (
              <ul className="divide-y divide-line rounded-lg border-2 border-line">
                {allProps.map((p) => {
                  const i = props.indexOf(p.id);
                  return (
                    <li key={p.id}>
                      <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2">
                        <input type="checkbox" className="size-6 shrink-0 accent-[var(--accent)]" checked={i >= 0} onChange={() => setProps((x) => toggle(x, p.id))} aria-label={p.label} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{p.label}</span>
                          {p.sub && <span className="block truncate text-sm text-muted">{p.sub}</span>}
                        </span>
                        {i >= 0 && <span className="num label shrink-0 text-xs text-accent">Stop {i + 1}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No buildings on this account yet. Search to add one.</p>
            )}
            {allProps.length > 1 && (
              <div className="mt-2 flex gap-2">
                <button type="button" className={btn("ghost", "sm")} onClick={() => setProps(allProps.map((p) => p.id))}>
                  Pick all {allProps.length}
                </button>
                {props.length > 0 && (
                  <button type="button" className={btn("ghost", "sm")} onClick={() => setProps([])}>
                    Clear
                  </button>
                )}
              </div>
            )}
            <label className="relative mt-2 block">
              <span className="sr-only">Add another building</span>
              <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className={cn(input, "pl-9")} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add another building — name or address" />
            </label>
            {hits.length > 0 && (
              <ul className="mt-1 divide-y divide-line rounded-lg border-2 border-line bg-surface" aria-label="Buildings found">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                      onClick={() => {
                        setExtra((x) => [...x, h]);
                        setProps((x) => (x.includes(h.id) ? x : [...x, h.id]));
                        setQ("");
                        setHits([]);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{h.label}</span>
                        {h.sub && <span className="block truncate text-sm text-muted">{h.sub}</span>}
                      </span>
                      {props.includes(h.id) && <IconCheck size={18} className="text-success" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {contacts.length > 0 && (
            <section aria-label="Who's attending">
              <div className={cn(labelText, "mb-2")}>Who&apos;s attending</div>
              <div className="flex flex-wrap gap-2">
                {contacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={people.includes(c.id)}
                    onClick={() => setPeople((x) => toggle(x, c.id))}
                    className={cn("min-h-12 rounded-lg border-2 px-3 text-left text-sm", people.includes(c.id) ? "border-ink bg-ink text-ground" : "border-line bg-surface")}
                  >
                    <span className="block font-semibold">{c.name}</span>
                    {c.title && <span className={cn("block text-xs", people.includes(c.id) ? "text-ground/70" : "text-muted")}>{c.title}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Title</span>
            <input
              className={input}
              value={shownTitle}
              maxLength={200}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Notes</span>
            <textarea className={cn(input, "py-2")} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code 4411, ask for Dave at the leasing office" />
          </label>
          <div className={cn("grid gap-3", ctx.members ? "grid-cols-2" : "grid-cols-1")}>
            {ctx.members && (
              <label className="flex flex-col gap-1.5">
                <span className={labelText}>Rep</span>
                <select className={input} value={assignee || ctx.meId} onChange={(e) => setAssignee(e.target.value)}>
                  {ctx.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === ctx.meId ? `${m.name} (me)` : m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Reminder</span>
              <select className={input} value={reminder} onChange={(e) => setReminder(Number(e.target.value))}>
                {REMINDERS.map((m) => (
                  <option key={m} value={m}>
                    {reminderLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface px-4 pb-1 pt-3">
            <button type="button" className={btn("primary", "lg", "w-full")} disabled={pending} onClick={save}>
              {pending ? "Saving…" : existing ? "Save changes" : props.length > 1 ? `Schedule ${props.length} buildings` : "Schedule it"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
