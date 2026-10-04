"use client";
import { useState } from "react";
import type { ApptCard } from "@/lib/appointments/types";
import { ApptRow, ScheduleButton } from "@/components/appointments/appt-card";
import { IconChevronDown } from "@/components/icons";
import { cn } from "@/components/ui/styles";

export type MyAppointments = { today: ApptCard[]; upcoming: ApptCard[]; overdue: ApptCard[] };

/** Top of Today (and Go): today's appointments in time order, then "Coming up" (next 7 days), collapsed. */
export function TodayAppointments({ d, expandable = false, showSchedule = true }: { d: MyAppointments; expandable?: boolean; showSchedule?: boolean }) {
  const [more, setMore] = useState(false);
  const today = [...d.overdue, ...d.today];
  return (
    <section aria-label="Today's appointments" data-testid="today-appointments">
      <div className="flex min-h-12 items-center justify-between gap-2 px-4 pt-4">
        <h2 className="label text-sm text-muted">Today&apos;s appointments{d.today.length > 0 && ` · ${d.today.length}`}</h2>
        {showSchedule && <ScheduleButton target={{}} label="Schedule" variant="ghost" size="sm" />}
      </div>
      {today.length ? (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {today.map((a) => (
            <ApptRow key={a.id} a={a} showDay={a.date !== today[0]?.date || a.needsOutcome} expandable={expandable} />
          ))}
        </ul>
      ) : (
        <p className="mx-4 rounded-lg border-2 border-dashed border-line px-4 py-3 text-sm text-muted">
          Nothing on the books today. Booked a walk or an inspection? Schedule it so it shows up here.
        </p>
      )}
      {d.upcoming.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className="flex min-h-12 w-full items-center gap-2 px-4 text-left"
          >
            <IconChevronDown size={18} className={cn("motion-safe:transition-transform", more && "rotate-180")} />
            <span className="label text-sm text-muted">Coming up · {d.upcoming.length}</span>
            {!more && <span className="min-w-0 flex-1 truncate text-sm text-muted">Next: {d.upcoming[0].dayLabel} {d.upcoming[0].timeLabel}</span>}
          </button>
          {more && (
            <ul className="divide-y divide-line border-y border-line bg-surface" aria-label="Coming up">
              {d.upcoming.map((a) => (
                <ApptRow key={a.id} a={a} showDay actions={false} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
