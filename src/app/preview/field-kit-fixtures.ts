// Fixtures for the field-kit preview screens (log-photos, property-photos, card-scan, go-route, offline-queued).
import type { Stop } from "@/components/go/types";
import type { PhotoTile } from "@/components/photos/property-photos";
import type { QueuedLog } from "@/lib/offline/types";
import type { CardPrefill } from "@/components/log/card-scan";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A roof-ish placeholder (membrane, seams, a drain) as an SVG data URL. */
export function roofPhoto(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},8%,78%)"/><stop offset="1" stop-color="hsl(${hue},10%,58%)"/></linearGradient></defs>
<rect width="480" height="480" fill="url(#g)"/>
${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${40 + i * 64}" x2="480" y2="${10 + i * 64}" stroke="hsl(${hue},6%,48%)" stroke-width="3"/>`).join("")}
<ellipse cx="${150 + (hue % 180)}" cy="300" rx="90" ry="38" fill="hsl(205,25%,42%)" opacity=".55"/>
<circle cx="${150 + (hue % 180)}" cy="300" r="12" fill="#333"/>
<rect x="0" y="420" width="480" height="60" fill="rgba(0,0,0,.35)"/>
<text x="20" y="460" font-family="sans-serif" font-size="28" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function cardImage(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="200"><rect width="350" height="200" rx="10" fill="#fdfdfb"/>
<rect x="0" y="0" width="12" height="200" fill="#e4570f"/><text x="34" y="62" font-family="sans-serif" font-size="26" font-weight="700" fill="#15202b">Rachel Ibarra</text>
<text x="34" y="92" font-family="sans-serif" font-size="16" fill="#5b6670">Director of Facilities</text><text x="34" y="130" font-family="sans-serif" font-size="15" fill="#15202b">Sunbelt Medical Properties</text>
<text x="34" y="160" font-family="sans-serif" font-size="13" fill="#5b6670">(512) 555-0188 · ribarra@sunbeltmed.com</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function fieldKitFixtures(today: string, austinStops: Stop[]) {
  const daysAgo = (n: number) => new Date(Date.parse(`${today}T15:00:00Z`) - n * 86_400_000).toISOString();
  const photos: PhotoTile[] = [
    { id: id(901), url: roofPhoto(30, "Bldg C · west drain"), caption: "Ponding at the west drain", takenAt: daysAgo(0), by: "Colby Reed", mine: true, width: 1600, height: 1200, touchId: id(950) },
    { id: id(902), url: roofPhoto(200, "Bldg C · seam"), caption: "Seam split, 6 ft", takenAt: daysAgo(0), by: "Colby Reed", mine: true, width: 1600, height: 1200, touchId: id(950) },
    { id: id(903), url: roofPhoto(90, "Bldg B · RTU curb"), caption: null, takenAt: daysAgo(0), by: "Colby Reed", mine: true, width: 1200, height: 1600, touchId: id(950) },
    { id: id(904), url: roofPhoto(150, "Bldg D · flashing"), caption: "Flashing pulled back", takenAt: daysAgo(12), by: "Kayla Ortiz", mine: false, width: 1600, height: 1200, touchId: null },
    { id: id(905), url: roofPhoto(260, "Bldg A · overview"), caption: "Overview from the hatch", takenAt: daysAgo(12), by: "Kayla Ortiz", mine: false, width: 1600, height: 1200, touchId: null },
    { id: id(906), url: roofPhoto(330, "Bldg F · scupper"), caption: null, takenAt: daysAgo(40), by: "Tyler Fox", mine: false, width: 1600, height: 1200, touchId: null },
  ];
  // Austin pins (approximate) so Route can order them.
  const pins: [number, number][] = [
    [30.3346, -97.7226],
    [30.2329, -97.7178],
    [30.2984, -97.7056],
    [30.3592, -97.7341],
    [30.2512, -97.7493],
    [30.3901, -97.7247],
  ];
  const routeStops: Stop[] = austinStops.map((s, i) => ({ ...s, lat: pins[i % pins.length][0], lng: pins[i % pins.length][1], mapsAddress: [s.address, s.city, "TX"].filter(Boolean).join(", ") }));
  const queued: QueuedLog[] = [
    {
      key: id(971),
      userId: id(1),
      tenantId: id(2),
      createdAt: new Date(Date.parse(`${today}T15:42:00Z`)).toISOString(),
      seq: 1,
      input: { accountId: austinStops[0]?.accountId, channel: "roof_walk", outcome: "met_in_person", source: "field" },
      photos: [],
      label: "Roof walk · Met in person · Asset Living",
      href: null,
      status: "pending",
      attempts: 1,
    },
    {
      key: id(972),
      userId: id(1),
      tenantId: id(2),
      createdAt: new Date(Date.parse(`${today}T16:05:00Z`)).toISOString(),
      seq: 2,
      input: { accountId: austinStops[1]?.accountId, channel: "site_visit", outcome: "gatekeeper", source: "field" },
      photos: [],
      label: "Site visit · Gatekeeper · Greystar — Austin",
      href: null,
      status: "pending",
      attempts: 0,
    },
  ];
  const card: { prefill: CardPrefill; text: string; thumb: string } = {
    thumb: cardImage(),
    text: "Filled in from the card — check it, then add.",
    prefill: {
      path: null,
      fields: {
        first_name: "Rachel",
        last_name: "Ibarra",
        full_name: "Rachel Ibarra",
        title: "Director of Facilities",
        company: "Sunbelt Medical Properties",
        email: "ribarra@sunbeltmed.com",
        phone: "(512) 555-0188",
        mobile: "(512) 555-0142",
        website: "sunbeltmed.com",
        address: "4100 Duval Rd, Austin, TX 78759",
      },
      notes: "From business card — Web: sunbeltmed.com · Address: 4100 Duval Rd, Austin, TX 78759",
      account: null,
      company: "Sunbelt Medical Properties",
    },
  };
  return { photos, routeStops, queued, card };
}
