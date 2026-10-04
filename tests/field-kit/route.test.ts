import { describe, expect, it } from "vitest";
import { formatMiles, haversineMiles, legDistances, mapsDirectionsUrls, MAX_WAYPOINTS, nearestNeighborOrder, type RouteStop } from "@/lib/geo/route";
import { censusUrl, oneLineAddress, parseCensus, rateLimiter } from "@/lib/geo/census";

const stop = (id: string, lat: number | null, lng: number | null, address: string | null = `${id} Main St, Austin, TX`): RouteStop => ({ id, label: id, address, lat, lng });

describe("haversine", () => {
  it("Austin → Dallas is ~182 straight-line miles", () => {
    expect(haversineMiles({ lat: 30.2672, lng: -97.7431 }, { lat: 32.7767, lng: -96.797 })).toBeGreaterThan(175);
    expect(haversineMiles({ lat: 30.2672, lng: -97.7431 }, { lat: 32.7767, lng: -96.797 })).toBeLessThan(190);
    expect(haversineMiles({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
  it("formats miles for the field", () => {
    expect(formatMiles(0.04)).toBe("< 0.1 mi");
    expect(formatMiles(2.345)).toBe("2.3 mi");
    expect(formatMiles(14.6)).toBe("15 mi");
    expect(formatMiles(null)).toBe("");
  });
});

describe("nearest-neighbour ordering", () => {
  // On a line of longitude: A(0) B(1) C(2) D(3) degrees north.
  const A = stop("A", 30.0, -97.7);
  const B = stop("B", 30.01, -97.7);
  const C = stop("C", 30.02, -97.7);
  const D = stop("D", 30.03, -97.7);

  it("from the rep's location, always the closest next", () => {
    const order = nearestNeighborOrder([C, A, D, B], { lat: 30.031, lng: -97.7 });
    expect(order.map((s) => s.id)).toEqual(["D", "C", "B", "A"]);
  });
  it("without a location, starts at the first stop in the current order", () => {
    expect(nearestNeighborOrder([B, D, A, C], null).map((s) => s.id)).toEqual(["B", "A", "C", "D"]);
    expect(nearestNeighborOrder([D, A, B, C], null).map((s) => s.id)).toEqual(["D", "C", "B", "A"]);
  });
  it("stops without a pin go last, in their original order", () => {
    const X = stop("X", null, null);
    const Y = stop("Y", null, null);
    expect(nearestNeighborOrder([X, C, Y, A], { lat: 29.9, lng: -97.7 }).map((s) => s.id)).toEqual(["A", "C", "X", "Y"]);
    expect(nearestNeighborOrder([X, Y], null).map((s) => s.id)).toEqual(["X", "Y"]);
  });
  it("leg distances: from origin, then stop to stop; null without coordinates", () => {
    const d = legDistances([A, B, stop("X", null, null)], { lat: 30.0, lng: -97.7 });
    expect(d[0]).toBe(0);
    expect(d[1]).toBeCloseTo(0.69, 1);
    expect(d[2]).toBeNull();
  });
});

const parse = (url: string) => {
  const u = new URL(url);
  expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
  expect(u.searchParams.get("api")).toBe("1");
  return {
    origin: u.searchParams.get("origin"),
    destination: u.searchParams.get("destination"),
    waypoints: u.searchParams.get("waypoints")?.split("|") ?? [],
  };
};

describe("Google Maps directions URLs", () => {
  it("one URL: origin = rep, every stop in order, last one is the destination", () => {
    const stops = [stop("1", 30, -97), stop("2", 30.1, -97), stop("3", 30.2, -97)];
    const legs = mapsDirectionsUrls(stops, { lat: 30.5, lng: -97.25 });
    expect(legs).toHaveLength(1);
    const p = parse(legs[0].url);
    expect(p.origin).toBe("30.500000,-97.250000");
    expect(p.waypoints).toEqual(["1 Main St, Austin, TX", "2 Main St, Austin, TX"]);
    expect(p.destination).toBe("3 Main St, Austin, TX");
    expect(legs[0].url).toContain("waypoints=1+Main+St%2C+Austin%2C+TX%7C2+Main");
    expect(legs[0]).toMatchObject({ from: 1, to: 3 });
  });

  it("no location: starts at stop 1; falls back to lat,lng when there's no address", () => {
    const legs = mapsDirectionsUrls([stop("1", 30, -97), stop("2", 30.123456, -97.654321, null)], null);
    const p = parse(legs[0].url);
    expect(p.origin).toBe("1 Main St, Austin, TX");
    expect(p.destination).toBe("30.123456,-97.654321");
    expect(p.waypoints).toEqual([]);
  });

  it("a single stop with no location is just a destination", () => {
    const p = parse(mapsDirectionsUrls([stop("1", 30, -97)], null)[0].url);
    expect(p.origin).toBeNull();
    expect(p.destination).toBe("1 Main St, Austin, TX");
  });

  it("more than 9 waypoints → legs; each leg starts where the last ended; ≤ 9 waypoints each; nothing skipped", () => {
    const stops = Array.from({ length: 23 }, (_, i) => stop(String(i + 1), 30 + i / 100, -97));
    const legs = mapsDirectionsUrls(stops, { lat: 29.9, lng: -97 });
    expect(legs).toHaveLength(3);
    const parsed = legs.map((l) => parse(l.url));
    for (const p of parsed) expect(p.waypoints.length).toBeLessThanOrEqual(MAX_WAYPOINTS);
    expect(parsed[0].origin).toBe("29.900000,-97.000000");
    expect(parsed[1].origin).toBe(parsed[0].destination);
    expect(parsed[2].origin).toBe(parsed[1].destination);
    const visited = parsed.flatMap((p) => [...p.waypoints, p.destination]);
    expect(visited).toEqual(stops.map((s) => s.address));
    expect(legs.map((l) => [l.from, l.to])).toEqual([
      [1, 10],
      [10, 20],
      [20, 23],
    ]);
  });

  it("exactly 11 stops without a location fit one URL (origin + 9 waypoints + destination)", () => {
    const stops = Array.from({ length: 11 }, (_, i) => stop(String(i + 1), 30, -97));
    const legs = mapsDirectionsUrls(stops, null);
    expect(legs).toHaveLength(1);
    expect(parse(legs[0].url).waypoints).toHaveLength(9);
    expect(mapsDirectionsUrls([...stops, stop("12", 30, -97)], null)).toHaveLength(2);
  });

  it("no stops → no URL", () => {
    expect(mapsDirectionsUrls([], null)).toEqual([]);
  });
});

describe("Census geocoder", () => {
  it("builds the documented URL", () => {
    const u = new URL(censusUrl("1801 S Pleasant Valley Rd, Austin, TX 78741"));
    expect(u.origin + u.pathname).toBe("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    expect(u.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.get("address")).toBe("1801 S Pleasant Valley Rd, Austin, TX 78741");
  });
  it("parses x=lng, y=lat; no match; garbage", () => {
    expect(parseCensus({ result: { addressMatches: [{ matchedAddress: "1801 S PLEASANT VALLEY RD, AUSTIN, TX, 78741", coordinates: { x: -97.7178123, y: 30.2329456 } }] } })).toEqual({
      status: "ok",
      lat: 30.232946,
      lng: -97.717812,
      matched: "1801 S PLEASANT VALLEY RD, AUSTIN, TX, 78741",
    });
    expect(parseCensus({ result: { addressMatches: [] } })).toEqual({ status: "nomatch" });
    expect(parseCensus({ nope: true }).status).toBe("error");
  });
  it("only geocodes real street addresses", () => {
    expect(oneLineAddress({ address1: "1801 S Pleasant Valley Rd", city: "Austin", state: "TX", zip: "78741" })).toBe("1801 S Pleasant Valley Rd, Austin, TX 78741");
    expect(oneLineAddress({ address1: "Riverside campus", city: "Austin", state: "TX", zip: null })).toBeNull();
    expect(oneLineAddress({ address1: "12 Elm", city: null, state: null, zip: null })).toBeNull();
    expect(oneLineAddress({ address1: "12 Elm", city: null, state: null, zip: "78701" })).toBe("12 Elm, 78701");
  });
  it("rate limiter spaces calls to ≤ 5/s", async () => {
    let t = 0;
    const waits: number[] = [];
    const limit = rateLimiter(5, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    for (let i = 0; i < 6; i++) await limit();
    expect(waits).toEqual([200, 200, 200, 200, 200]);
    expect(t).toBe(1000); // 6 calls in 1 s = 5 intervals
  });
});
