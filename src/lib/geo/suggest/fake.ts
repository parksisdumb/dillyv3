// Deterministic suggestions for the e2e suite (DILLY_ADDRESS_PROVIDER=fake). Never calls the network.
// Tagged provider "photon": it stands in for the keyless default, and geocode_source only allows real providers.
import { MAX_SUGGESTIONS, type AddressSuggestion } from "./types";

const ROWS: Omit<AddressSuggestion, "id" | "label" | "provider">[] = [
  { address1: "1801 S Pleasant Valley Rd", city: "Austin", state: "TX", zip: "78741", lat: 30.238412, lng: -97.723061 },
  { address1: "1801 S Plemons St", city: "Memphis", state: "TN", zip: "38106", lat: 35.106221, lng: -90.031874 },
  { address1: "1801 Union Ave", city: "Memphis", state: "TN", zip: "38104", lat: 35.137144, lng: -90.012309 },
  { address1: "1801 Poplar Ave", city: "Memphis", state: "TN", zip: "38104", lat: 35.141301, lng: -90.010422 },
  { address1: "4801 Burnet Rd", city: "Austin", state: "TX", zip: "78756", lat: 30.319024, lng: -97.739604 },
  { address1: "500 E Cesar Chavez St", city: "Austin", state: "TX", zip: "78701", lat: 30.261985, lng: -97.739283 },
];

const label = (r: (typeof ROWS)[number]) => `${r.address1}, ${r.city}, ${r.state} ${r.zip}`;
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/** Every query token is a prefix of some label token; otherwise rows with the same house number. */
export function fakeSuggest(q: string): AddressSuggestion[] {
  const qt = tokens(q);
  const all = ROWS.map((r, i) => ({ ...r, id: `fake:${i}`, label: label(r), provider: "photon" as const }));
  const hits = all.filter((r) => {
    const lt = tokens(r.label);
    return qt.every((t) => lt.some((x) => x.startsWith(t)));
  });
  if (hits.length) return hits.slice(0, MAX_SUGGESTIONS);
  const house = qt[0];
  return house && /^\d+$/.test(house) ? all.filter((r) => r.address1?.startsWith(`${house} `)).slice(0, MAX_SUGGESTIONS) : [];
}
