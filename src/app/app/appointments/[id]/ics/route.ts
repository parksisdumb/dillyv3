// "Add to calendar" download: one VEVENT in the company's time zone (DTSTART;TZID=…), with a VTIMEZONE block.
import { ctx } from "@/lib/server/ctx";
import { loadAppointment } from "@/lib/server/appointments";
import { buildIcs, icsFileName } from "@/lib/domain/appointments";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx();
  const a = await loadAppointment(c, id);
  if (!a) return new Response("Not found", { status: 404 });
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
  const stops = a.stops.length > 1 ? a.stops.map((s, i) => `${i + 1}. ${s.name}${s.address ? ` — ${s.address}` : ""}`).join("\n") : null;
  const body = buildIcs({
    id: a.id,
    title: a.title,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    allDay: a.allDay,
    location: a.location,
    description: [stops, a.contacts.map((p) => [p.name, p.phone].filter(Boolean).join(" ")).join(", ") || null, a.notes].filter(Boolean).join("\n\n") || null,
    timeZone: a.timeZone,
    url: `${origin}/app/appointments/${a.id}`,
    updatedAt: a.updatedAt,
    status: a.status,
  });
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${icsFileName(a.title)}"`,
      "cache-control": "private, no-store",
    },
  });
}
