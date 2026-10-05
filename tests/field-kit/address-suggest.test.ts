import { afterEach, describe, expect, it, vi } from "vitest";
import { autocompleteBody, detailsUrl, DETAILS_FIELD_MASK, googleDetails, googleSuggest, looksUS, mapAutocomplete, mapDetails } from "@/lib/geo/suggest/google";
import { mapPhoton, photonSuggest, photonUrl } from "@/lib/geo/suggest/photon";
import { fakeSuggest } from "@/lib/geo/suggest/fake";
import { LruCache, slidingWindow } from "@/lib/geo/suggest/limits";
import { createSuggester } from "@/lib/geo/suggest/client";
import { parseNear, stateCode, usZip } from "@/lib/geo/suggest/types";

const GOOGLE_AUTOCOMPLETE = {
  suggestions: [
    {
      placePrediction: {
        place: "places/ChIJ_memphis_1801_union",
        placeId: "ChIJ_memphis_1801_union",
        text: { text: "1801 Union Ave, Memphis, TN, USA" },
        structuredFormat: { mainText: { text: "1801 Union Ave" }, secondaryText: { text: "Memphis, TN, USA" } },
      },
    },
    {
      placePrediction: {
        placeId: "ChIJ_toronto_1801_union",
        text: { text: "1801 Union St, Toronto, ON, Canada" },
        structuredFormat: { mainText: { text: "1801 Union St" }, secondaryText: { text: "Toronto, ON, Canada" } },
      },
    },
    { queryPrediction: { text: { text: "1801 union pizza" } } },
  ],
};

const GOOGLE_DETAILS = {
  id: "ChIJ_memphis_1801_union",
  formattedAddress: "1801 Union Ave Suite 200, Memphis, TN 38104, USA",
  location: { latitude: 35.13714412, longitude: -90.01230911 },
  addressComponents: [
    { longText: "1801", shortText: "1801", types: ["street_number"] },
    { longText: "Union Avenue", shortText: "Union Ave", types: ["route"] },
    { longText: "200", shortText: "200", types: ["subpremise"] },
    { longText: "Midtown", shortText: "Midtown", types: ["neighborhood", "political"] },
    { longText: "Memphis", shortText: "Memphis", types: ["locality", "political"] },
    { longText: "Shelby County", shortText: "Shelby County", types: ["administrative_area_level_2", "political"] },
    { longText: "Tennessee", shortText: "TN", types: ["administrative_area_level_1", "political"] },
    { longText: "United States", shortText: "US", types: ["country", "political"] },
    { longText: "38104", shortText: "38104", types: ["postal_code"] },
    { longText: "1234", shortText: "1234", types: ["postal_code_suffix"] },
  ],
};

const PHOTON = {
  type: "FeatureCollection",
  features: [
    {
      geometry: { type: "Point", coordinates: [-97.7230612, 30.2384121] },
      properties: { osm_type: "N", osm_id: 1, countrycode: "US", housenumber: "1801", street: "South Pleasant Valley Road", city: "Austin", state: "Texas", postcode: "78741", type: "house" },
    },
    {
      geometry: { type: "Point", coordinates: [-79.38, 43.65] },
      properties: { osm_type: "N", osm_id: 2, countrycode: "CA", housenumber: "1801", street: "Union Street", city: "Toronto", state: "Ontario", postcode: "M5V" },
    },
    {
      geometry: { type: "Point", coordinates: [-90.0123, 35.1371] },
      properties: { osm_type: "W", osm_id: 3, countrycode: "US", name: "Union Avenue", osm_key: "highway", city: "Memphis", state: "Tennessee", postcode: "38104", type: "street" },
    },
    {
      geometry: { type: "Point", coordinates: [-90.0233, 35.0478] },
      properties: { osm_type: "W", osm_id: 4, countrycode: "US", name: "Graceland", housenumber: "3764", street: "Elvis Presley Boulevard", city: "Memphis", state: "Tennessee", postcode: "38116" },
    },
    { geometry: { type: "Point", coordinates: [-86.7, 36.1] }, properties: { countrycode: "US", name: "Nashville", type: "city", state: "Tennessee" } },
  ],
};

const okJson = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

describe("Google Places (New) mapping", () => {
  it("autocomplete → label-only US suggestions that need details", () => {
    const s = mapAutocomplete(GOOGLE_AUTOCOMPLETE);
    expect(s).toEqual([
      {
        id: "google:ChIJ_memphis_1801_union",
        label: "1801 Union Ave, Memphis, TN",
        address1: "1801 Union Ave",
        city: null,
        state: null,
        zip: null,
        lat: null,
        lng: null,
        provider: "google",
        needsDetails: true,
      },
    ]);
    expect(mapAutocomplete({})).toEqual([]);
    expect(mapAutocomplete(null)).toEqual([]);
  });

  it("looksUS keeps US / bare secondary text and drops other countries", () => {
    expect(looksUS("Memphis, TN, USA")).toBe(true);
    expect(looksUS("Memphis, TN")).toBe(true);
    expect(looksUS("")).toBe(true);
    expect(looksUS("Toronto, ON, Canada")).toBe(false);
    expect(looksUS("Monterrey, N.L., Mexico")).toBe(false);
  });

  it("details → components, ZIP+4, unit and a rounded pin", () => {
    expect(mapDetails(GOOGLE_DETAILS)).toEqual({
      id: "google:ChIJ_memphis_1801_union",
      label: "1801 Union Ave Suite 200, Memphis, TN 38104",
      address1: "1801 Union Ave #200",
      city: "Memphis",
      state: "TN",
      zip: "38104-1234",
      lat: 35.137144,
      lng: -90.012309,
      provider: "google",
    });
  });

  it("details outside the US → null", () => {
    const ca = { ...GOOGLE_DETAILS, addressComponents: GOOGLE_DETAILS.addressComponents.map((c) => (c.types.includes("country") ? { longText: "Canada", shortText: "CA", types: ["country"] } : c)) };
    expect(mapDetails(ca)).toBeNull();
    expect(mapDetails({})).toBeNull();
  });

  it("requests: US only, bias circle, session token on autocomplete and details, field mask", async () => {
    expect(autocompleteBody("1801 Uni", { lat: 35.1, lng: -90 }, "tok-123456")).toEqual({
      input: "1801 Uni",
      includedRegionCodes: ["us"],
      regionCode: "us",
      languageCode: "en",
      sessionToken: "tok-123456",
      locationBias: { circle: { center: { latitude: 35.1, longitude: -90 }, radius: 50000 } },
    });
    expect(autocompleteBody("x y z", null, null)).not.toHaveProperty("locationBias");
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return okJson(url.includes(":autocomplete") ? GOOGLE_AUTOCOMPLETE : GOOGLE_DETAILS);
    }) as unknown as typeof fetch;
    await googleSuggest("1801 Uni", null, "tok-123456", { key: "K", fetchImpl });
    const d = await googleDetails("ChIJ_memphis_1801_union", "tok-123456", { key: "K", fetchImpl });
    expect(d?.zip).toBe("38104-1234");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("K");
    expect(calls[1].url).toBe(detailsUrl("ChIJ_memphis_1801_union", "tok-123456"));
    expect(calls[1].url).toContain("sessionToken=tok-123456");
    expect((calls[1].init?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(DETAILS_FIELD_MASK);
  });
});

describe("Photon mapping", () => {
  it("keeps US addresses with a street; pins only house-numbered hits; full state names → codes", () => {
    const s = mapPhoton(PHOTON);
    expect(s.map((x) => x.label)).toEqual([
      "1801 South Pleasant Valley Road, Austin, TX 78741",
      "Union Avenue, Memphis, TN 38104",
      "Graceland · 3764 Elvis Presley Boulevard, Memphis, TN 38116",
    ]);
    expect(s[0]).toMatchObject({ address1: "1801 South Pleasant Valley Road", city: "Austin", state: "TX", zip: "78741", lat: 30.238412, lng: -97.723061, provider: "photon" });
    expect(s[1]).toMatchObject({ address1: "Union Avenue", lat: null, lng: null }); // street-only: no pin
    expect(s[2]).toMatchObject({ address1: "3764 Elvis Presley Boulevard", lat: 35.0478, lng: -90.0233 });
    expect(s.every((x) => x.provider === "photon")).toBe(true);
    expect(mapPhoton({ nope: 1 })).toEqual([]);
  });

  it("caps at six and de-duplicates", () => {
    const f = PHOTON.features[0];
    const many = { features: Array.from({ length: 9 }, (_, i) => ({ ...f, properties: { ...f.properties, housenumber: String(100 + (i % 8)) } })) };
    expect(mapPhoton(many)).toHaveLength(6);
    const dup = { features: [f, f] };
    expect(mapPhoton(dup)).toHaveLength(1);
  });

  it("url + descriptive User-Agent, no key", async () => {
    const u = new URL(photonUrl("1801 S Ple", { lat: 35.149, lng: -90.049 }));
    expect(u.origin + u.pathname).toBe("https://photon.komoot.io/api/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "1801 S Ple", limit: "10", lang: "en", lat: "35.1490", lon: "-90.0490" });
    let ua = "";
    const fetchImpl = ((_: string, init?: RequestInit) => {
      ua = (init?.headers as Record<string, string>)["User-Agent"];
      return okJson(PHOTON);
    }) as unknown as typeof fetch;
    expect(await photonSuggest("1801", null, { fetchImpl })).toHaveLength(3);
    expect(ua).toMatch(/^Dilly\/1\.0 \(/);
  });
});

describe("helpers", () => {
  it("parseNear / stateCode / usZip", () => {
    expect(parseNear("35.1495,-90.0490")).toEqual({ lat: 35.1495, lng: -90.049 });
    expect(parseNear("91,0")).toBeNull();
    expect(parseNear("abc")).toBeNull();
    expect(parseNear(null)).toBeNull();
    expect(stateCode("Tennessee")).toBe("TN");
    expect(stateCode("tx")).toBe("TX");
    expect(stateCode("Ontario")).toBe("Ontario");
    expect(usZip("38104")).toBe("38104");
    expect(usZip("38104 1234")).toBe("38104-1234");
    expect(usZip("M5V")).toBeNull();
  });

  it("fake provider is deterministic", () => {
    expect(fakeSuggest("1801 S Ple").map((s) => s.label)).toEqual(["1801 S Pleasant Valley Rd, Austin, TX 78741", "1801 S Plemons St, Memphis, TN 38106"]);
    expect(fakeSuggest("1801 Nowhere Ln").map((s) => s.city)).toEqual(["Austin", "Memphis", "Memphis", "Memphis"]);
    expect(fakeSuggest("Riverside campus")).toEqual([]);
  });
});

describe("rate limiter + cache", () => {
  it("allows 60 per minute per user, then says how long to wait", () => {
    let t = 1_000_000;
    const lim = slidingWindow(60, 60_000, () => t);
    for (let i = 0; i < 60; i++) expect(lim.take("u1")).toBe(0);
    expect(lim.take("u1")).toBe(60_000);
    expect(lim.take("u2")).toBe(0); // per user
    t += 30_000;
    expect(lim.take("u1")).toBe(30_000);
    t += 30_001;
    expect(lim.take("u1")).toBe(0);
  });

  it("LRU evicts the least recent and expires after the TTL", () => {
    let t = 0;
    const c = new LruCache<number>(2, 600_000, () => t);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // a is now most recent
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    t += 600_001;
    expect(c.get("a")).toBeUndefined();
  });
});

describe("client debounce / abort", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces 250 ms, sends only the last query, aborts the earlier ones", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      urls.push(url);
      return okJson({ suggestions: [{ id: "x", label: "1801 Union Ave" }] });
    }) as unknown as typeof fetch;
    const s = createSuggester({ fetchImpl, session: () => "tok-123456", near: () => ({ lat: 35.1, lng: -90 }) });
    const a = s.request("180");
    const b = s.request("1801");
    const c = s.request("1801 U");
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await a).toEqual({ ok: false, reason: "aborted" });
    expect(await b).toEqual({ ok: false, reason: "aborted" });
    expect(await c).toMatchObject({ ok: true, suggestions: [{ label: "1801 Union Ave" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const u = new URL(urls[0], "http://x");
    expect(u.pathname).toBe("/api/address/suggest");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "1801 U", session: "tok-123456", near: "35.1000,-90.0000" });
  });

  it("aborts an in-flight request when a newer one starts", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl = ((_: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>((resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        setTimeout(() => resolve(new Response(JSON.stringify({ suggestions: [] }))), 1000);
      });
    }) as unknown as typeof fetch;
    const s = createSuggester({ fetchImpl });
    const first = s.request("1801 Uni");
    await vi.advanceTimersByTimeAsync(300); // first is in flight
    const second = s.request("1801 Union");
    expect(signals[0].aborted).toBe(true);
    expect(await first).toEqual({ ok: false, reason: "aborted" });
    await vi.advanceTimersByTimeAsync(1300);
    expect(await second).toEqual({ ok: true, suggestions: [] });
  });

  it("short queries and offline never hit the network; errors resolve quietly", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("{}", { status: 502 }))) as unknown as typeof fetch;
    expect(await createSuggester({ fetchImpl }).request("18")).toEqual({ ok: false, reason: "short" });
    expect(await createSuggester({ fetchImpl, online: () => false }).request("1801 Union")).toEqual({ ok: false, reason: "offline" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await createSuggester({ fetchImpl, delayMs: 0 }).request("1801 Union")).toEqual({ ok: false, reason: "error" });
  });
});
