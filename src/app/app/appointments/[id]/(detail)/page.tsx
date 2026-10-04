import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { loadAppointment } from "@/lib/server/appointments";
import { googleCalendarUrl } from "@/lib/domain/appointments";
import { AppointmentDetailView } from "@/components/appointments/appointment-detail-view";

export const metadata: Metadata = { title: "Appointment" };

async function AppointmentPageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx();
  const a = await loadAppointment(c, id);
  if (!a) notFound();
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? null;
  const google = googleCalendarUrl({
    id: a.id,
    title: a.title,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    allDay: a.allDay,
    location: a.location,
    description: [a.stops.length > 1 ? a.stops.map((s, i) => `${i + 1}. ${s.name}${s.address ? ` — ${s.address}` : ""}`).join("\n") : null, a.notes].filter(Boolean).join("\n\n") || null,
    timeZone: a.timeZone,
    url: base ? `${base}/app/appointments/${a.id}` : null,
  });
  return <AppointmentDetailView a={a} google={google} today={c.today} />;
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function AppointmentPage(props: Parameters<typeof AppointmentPageBody>[0]) {
  const key = JSON.stringify(await props.params);
  return pageBody(() => AppointmentPageBody(props), key);
}
