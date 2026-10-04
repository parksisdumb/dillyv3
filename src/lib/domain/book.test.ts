import { describe, expect, it } from "vitest";
import { ageBand, ageBandYears, isGoingQuiet, normalizeAddress } from "./book";

describe("normalizeAddress", () => {
  it("matches the SQL normalizer", () => {
    expect(normalizeAddress("1801 S. Pleasant Valley Road", "Austin")).toBe("1801 s pleasant valley rd austin");
    expect(normalizeAddress("600 Congress Avenue, Ste 1400", "AUSTIN")).toBe("600 congress ave ste 1400 austin");
    expect(normalizeAddress("11400 Domain Drive", null)).toBe("11400 domain dr");
    expect(normalizeAddress("Streetside Lane", "x")).toBe("streetside ln x");
    expect(normalizeAddress(null, null)).toBeNull();
  });
});

describe("roof age bands", () => {
  it("bands by install year", () => {
    expect(ageBand(2020, 2026)).toBe("lt10");
    expect(ageBand(2014, 2026)).toBe("10to15");
    expect(ageBand(2009, 2026)).toBe("15to20");
    expect(ageBand(2001, 2026)).toBe("20plus");
    expect(ageBand(null, 2026)).toBe("unknown");
  });
  it("year bounds agree with bands", () => {
    for (const band of ["lt10", "10to15", "15to20", "20plus"] as const) {
      const { min, max } = ageBandYears(band, 2026);
      if (min) expect(ageBand(min, 2026)).toBe(band);
      if (max) expect(ageBand(max, 2026)).toBe(band);
    }
  });
});

describe("isGoingQuiet", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("uses the account tier threshold", () => {
    expect(isGoingQuiet("2026-09-15T12:00:00Z", 1, now)).toBe(true); // 19d > 14
    expect(isGoingQuiet("2026-09-15T12:00:00Z", 2, now)).toBe(false); // 19d < 21
    expect(isGoingQuiet(null, 1, now)).toBe(false);
  });
});
