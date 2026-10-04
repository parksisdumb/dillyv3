import Link from "next/link";
import type { ApptDetail } from "@/lib/appointments/types";
import { APPT_STATUS, durationLabel, reminderLabel, utcToZoned, clockLabel, dayLabel } from "@/lib/domain/appointments";
import { CHANNELS, OUTCOMES, type Channel, type Outcome } from "@/lib/domain/vocab";
import { mapsDirectionsUrls } from "@/lib/geo/route";
import { Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { IconDirections, IconMail, IconPhone, IconRoute } from "@/components/icons";
import { ApptManage, LogOutcomeButton } from "@/components/appointments/appt-card";
import { CopyText } from "@/components/appointments/copy-text";
import { LogContext } from "@/components/log/log-provider";

const TONE: Record<string, "good" | "bad" | "neutral" | "accent"> = { scheduled: "accent", done: "good", canceled: "bad", no_show: "bad" };

export function AppointmentDetailView({ a, google, today }: { a: ApptDetail; google: string; today: string }) {
  const minutes = a.endsAt ? Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000) : null;
  const route = a.stops.length > 1 ? mapsDirectionsUrls(a.stops.map((s) => ({ id: s.propertyId, label: s.name, address: s.address, lat: s.lat, lng: s.lng })), null) : [];
  const fmtChange = (field: string, v: string | null) => {
    if (!v) return "—";
    if (field === "starts_at") {
      const z = utcToZoned(v, a.timeZone);
      return `${dayLabel(z.date, today)} ${clockLabel(z.time)}`;
    }
    if (field === "status") return APPT_STATUS[v as keyof typeof APPT_STATUS] ?? v;
    return "reassigned";
  };
  return (
    <div>
      <LogContext accountId={a.accountId} propertyId={a.stops.length === 1 ? a.stops[0].propertyId : null} />
      <PageHeader
        back="/app/today"
        title={a.title}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={TONE[a.status] ?? "neutral"}>{APPT_STATUS[a.status]}</Chip>
            <span className="font-semibold text-ink">
              {a.dayLabel} · {a.timeLabel}
            </span>
            {minutes && !a.allDay ? <span>{durationLabel(minutes)}</span> : null}
          </span>
        }
      />
      <div className="flex flex-col gap-1 px-4 text-sm">
        {a.accountId && (
          <Link href={`/app/accounts/${a.accountId}`} className="inline-flex min-h-12 items-center font-semibold underline decoration-line underline-offset-2">
            {a.accountName ?? "Account"}
          </Link>
        )}
        <span className="text-muted">
          {a.kindLabel}
          {a.assignedName ? ` · ${a.mine ? "You" : a.assignedName}` : ""}
          {a.status === "scheduled" ? ` · ${reminderLabel(a.reminderMinutes).toLowerCase()}` : ""}
          {a.rescheduleCount > 0 ? ` · moved ${a.rescheduleCount}×` : ""}
        </span>
        {a.cancelReason && <span className="text-danger">Canceled — {a.cancelReason}</span>}
      </div>

      {a.status === "scheduled" && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          <LogOutcomeButton a={a} size="lg" className="w-full" />
          <ApptManage a={a} />
        </div>
      )}
      {a.status !== "scheduled" && (
        <div className="px-4 pt-3">
          <ApptManage a={a} />
        </div>
      )}
      {a.outcome && (
        <p className="mx-4 mt-3 rounded-lg border-2 border-success px-3 py-2 text-sm">
          <span className="font-semibold">Logged:</span> {CHANNELS[a.outcome.channel as Channel]?.label ?? a.outcome.channel} · {OUTCOMES[a.outcome.outcome as Outcome]?.label ?? a.outcome.outcome}
          {a.outcome.notes ? ` — ${a.outcome.notes}` : ""}
        </p>
      )}

      <SectionTitle>{a.stops.length > 1 ? `Stops · ${a.stops.length} buildings in order` : "Where"}</SectionTitle>
      {a.stops.length > 0 ? (
        <ol className="divide-y divide-line border-y border-line bg-surface" aria-label="Stops in order">
          {a.stops.map((s, i) => (
            <li key={s.propertyId} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <span className="num w-6 shrink-0 font-display text-lg font-bold">{i + 1}</span>
              <Link href={`/app/properties/${s.propertyId}`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block truncate text-sm text-muted">{s.address ?? "No address"}</span>
              </Link>
              {s.directions && (
                <a href={s.directions} target="_blank" rel="noreferrer" className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Directions to ${s.name}`}>
                  <IconDirections size={20} className="shrink-0" />
                </a>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 text-sm text-muted">{a.location ?? "No building picked."}</p>
      )}
      <div className="flex flex-col gap-2 px-4 pt-3">
        {route.map((l, i) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className={btn(i === 0 ? "secondary" : "ghost", "md", "w-full")} data-testid="appointment-route">
            <IconRoute size={20} /> {route.length === 1 ? "All stops in Google Maps" : `Google Maps · stops ${l.from}–${l.to}`}
          </a>
        ))}
        {a.stops.length <= 1 && a.directions && (
          <a href={a.directions} target="_blank" rel="noreferrer" className={btn("secondary", "md", "w-full")}>
            <IconDirections size={20} className="shrink-0" /> Directions
          </a>
        )}
        {a.location && <CopyText text={a.location} label="Copy address" />}
      </div>

      <SectionTitle>Who&apos;s attending</SectionTitle>
      {a.contacts.length ? (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {a.contacts.map((p) => (
            <li key={p.id} className="flex min-h-14 items-center gap-2 px-4 py-2">
              <Link href={`/app/contacts/${p.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}</span>
                {p.title && <span className="block truncate text-sm text-muted">{p.title}</span>}
              </Link>
              {p.phone && (
                <a href={`tel:${p.phone}`} className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Call ${p.name}`}>
                  <IconPhone size={20} className="shrink-0" />
                </a>
              )}
              {p.email && (
                <a href={`mailto:${p.email}`} className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Email ${p.name}`}>
                  <IconMail size={20} className="shrink-0" />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 text-sm text-muted">Nobody added. Edit to add who you&apos;re meeting.</p>
      )}

      {a.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="whitespace-pre-wrap px-4 text-base">{a.notes}</p>
        </>
      )}

      <SectionTitle>Add to calendar</SectionTitle>
      <div className="grid grid-cols-2 gap-2 px-4">
        <a href={google} target="_blank" rel="noreferrer" className={btn("secondary", "md")}>
          Google Calendar
        </a>
        <a href={`/app/appointments/${a.id}/ics`} download className={btn("secondary", "md")} data-testid="ics-download">
          iPhone / Outlook (.ics)
        </a>
      </div>

      {a.changes.length > 0 && (
        <>
          <SectionTitle>History</SectionTitle>
          <ul className="flex flex-col gap-1 px-4 pb-6 text-sm text-muted">
            {a.changes.map((ch, i) => (
              <li key={i}>
                {ch.field === "starts_at" ? "Moved" : ch.field === "status" ? "Status" : "Rep"}: {fmtChange(ch.field, ch.oldValue)} → {fmtChange(ch.field, ch.newValue)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
