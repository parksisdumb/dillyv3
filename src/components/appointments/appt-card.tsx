"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ApptCard, ScheduleTarget } from "@/lib/appointments/types";
import { setAppointmentStatus } from "@/lib/actions/appointments";
import { useLog } from "@/components/log/log-provider";
import { ScheduleSheet } from "@/components/appointments/schedule-sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn } from "@/components/ui/styles";
import { IconCalendar, IconChevronDown, IconChevronRight, IconDirections, IconLog } from "@/components/icons";

/** "Schedule" button + its sheet (remounted per open so it always starts fresh). */
export function ScheduleButton({
  target,
  label = "Schedule",
  variant = "secondary",
  size = "md",
  className,
}: {
  target: ScheduleTarget;
  label?: string;
  variant?: "primary" | "secondary" | "accent-outline" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <button
        type="button"
        className={btn(variant, size, className)}
        onClick={() => {
          setN((x) => x + 1);
          setOpen(true);
        }}
      >
        <IconCalendar size={20} /> {label}
      </button>
      {open && <ScheduleSheet key={n} open={open} onClose={() => setOpen(false)} target={target} />}
    </>
  );
}

/** Opens the normal Log sheet in "outcome of this appointment" mode. */
export function LogOutcomeButton({ a, size = "md", className }: { a: ApptCard; size?: "sm" | "md" | "lg"; className?: string }) {
  const { openLog } = useLog();
  return (
    <button
      type="button"
      className={btn("primary", size, className)}
      onClick={() => openLog({ appointmentId: a.id, accountId: a.accountId, propertyId: a.stops.length === 1 ? a.stops[0].propertyId : null })}
    >
      <IconLog size={20} className="shrink-0" /> <span className="truncate">Log outcome</span>
    </button>
  );
}

/** Edit / reschedule / no-show / cancel. */
export function ApptManage({ a, compact = false }: { a: ApptCard; compact?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const run = (status: "canceled" | "no_show" | "scheduled") =>
    start(async () => {
      const r = await setAppointmentStatus({ id: a.id, status, reason: reason || null });
      if (r.ok) {
        toast(r.message ?? "Saved", status === "scheduled" ? "good" : "neutral");
        setConfirm(false);
        router.refresh();
      } else toast(r.error ?? "Didn't work", "bad");
    });
  if (a.status === "canceled" || a.status === "no_show") {
    return (
      <button type="button" disabled={pending} className={btn("secondary", "sm")} onClick={() => run("scheduled")}>
        Put back on the schedule
      </button>
    );
  }
  if (a.status !== "scheduled") return null;
  return (
    <>
      {confirm ? (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-warning p-3">
          <p className="text-sm font-semibold">Cancel this appointment?</p>
          <input className="min-h-12 w-full rounded-lg border-2 border-line bg-surface px-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional) — e.g. PM rescheduling" aria-label="Why" />
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className={btn("secondary", "sm")} onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button type="button" disabled={pending} className={btn("secondary", "sm")} onClick={() => run("no_show")}>
              No-show
            </button>
            <button type="button" disabled={pending} className={btn("danger", "sm")} onClick={() => run("canceled")}>
              Cancel it
            </button>
          </div>
        </div>
      ) : (
        <div className={cn("grid grid-cols-2 gap-2", compact && "mt-2")}>
          <button
            type="button"
            className={btn("secondary", "sm")}
            onClick={() => {
              setN((x) => x + 1);
              setEditing(true);
            }}
          >
            Reschedule / edit
          </button>
          <button type="button" className={btn("secondary", "sm")} onClick={() => setConfirm(true)}>
            Cancel…
          </button>
        </div>
      )}
      {editing && <ScheduleSheet key={n} open={editing} onClose={() => setEditing(false)} target={{ accountId: a.accountId }} existing={a} />}
    </>
  );
}

/** "Inspection · 3 buildings · Kayla" minus whatever the title already says. */
function sub(a: ApptCard): string {
  return [
    a.title.startsWith(a.kindLabel) ? null : a.kindLabel,
    a.stops.length > 1 && !/buildings\)$/.test(a.title) ? `${a.stops.length} buildings` : null,
    !a.mine && a.assignedName ? a.assignedName : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One appointment in a list (Today, Go, a record page): time, title, buildings, address, one-tap directions and
 * Log outcome. `expandable` shows the buildings in order (Go).
 */
export function ApptRow({ a, showDay = false, expandable = false, actions = true }: { a: ApptCard; showDay?: boolean; expandable?: boolean; actions?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3" data-testid="appointment" aria-label={`${a.timeLabel} ${a.title}`}>
      <div className="flex items-start gap-3">
        <div className="w-[4.5rem] shrink-0 pt-0.5">
          {showDay && <div className="label text-xs text-muted">{a.dayLabel}</div>}
          <div className={cn("num font-display text-lg font-bold leading-tight", a.needsOutcome && "text-warning")}>{a.timeLabel}</div>
        </div>
        <Link href={`/app/appointments/${a.id}`} className="-my-1 min-w-0 flex-1 rounded-lg py-1 hover:bg-surface-2" aria-label={`Open ${a.title}`}>
          <span className="block font-display text-base font-bold leading-snug">{a.title}</span>
          {sub(a) && <span className="block truncate text-sm text-muted">{sub(a)}</span>}
          {a.location && <span className="block truncate text-sm">{a.location}</span>}
          {a.needsOutcome && <span className="label block text-xs text-warning">No outcome logged yet</span>}
        </Link>
        <IconChevronRight size={20} className="mt-1 shrink-0 text-muted" />
      </div>
      {actions && (
        <div className="mt-2 flex min-w-0 items-center gap-2 pl-[5.25rem]">
          {a.directions ? (
            <a href={a.directions} target="_blank" rel="noreferrer" className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Directions to ${a.title}`}>
              <IconDirections size={20} className="shrink-0" />
            </a>
          ) : null}
          <LogOutcomeButton a={a} className="min-w-0 flex-1 px-2" />
          {expandable && a.stops.length > 1 && (
            <button type="button" aria-expanded={open} aria-label={`${a.stops.length} buildings`} onClick={() => setOpen((o) => !o)} className={btn("secondary", "md", "shrink-0 gap-1 px-2")}>
              {a.stops.length} <IconChevronDown size={18} className={cn("motion-safe:transition-transform", open && "rotate-180")} />
            </button>
          )}
        </div>
      )}
      {expandable && open && (
        <ol className="mt-2 ml-[5.25rem] divide-y divide-line rounded-lg border-2 border-line" aria-label="Buildings in order">
          {a.stops.map((s, i) => (
            <li key={s.propertyId} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
              <span className="num w-5 font-display font-bold text-muted">{i + 1}</span>
              <Link href={`/app/properties/${s.propertyId}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.name}</span>
                {s.address && <span className="block truncate text-xs text-muted">{s.address}</span>}
              </Link>
              {s.directions && (
                <a href={s.directions} target="_blank" rel="noreferrer" className="inline-flex size-12 items-center justify-center" aria-label={`Directions to ${s.name}`}>
                  <IconDirections size={18} className="shrink-0" />
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * The record-page entry point (property / account / contact): Schedule button + what's already booked here.
 * One line on each detail view.
 */
export function ScheduleEntry({ target, appointments = [], label = "Schedule" }: { target: ScheduleTarget; appointments?: ApptCard[]; label?: string }) {
  return (
    <section className="px-4 pt-2" aria-label="Appointments">
      <div className="flex items-center gap-2">
        <ScheduleButton target={target} label={label} className="flex-1" />
      </div>
      {appointments.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border-2 border-line bg-surface" aria-label="Booked here">
          {appointments.map((a) => (
            <ApptRow key={a.id} a={a} showDay actions={a.mine || a.needsOutcome} />
          ))}
        </ul>
      )}
    </section>
  );
}

