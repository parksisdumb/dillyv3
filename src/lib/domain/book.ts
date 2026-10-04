// Pure helpers for the Book (contacts and properties lists).
import { COLD_THRESHOLD_DAYS } from "@/lib/domain/vocab";

/** TypeScript port of app.normalize_address(addr, city) — must stay in step with 20261003000100_foundation.sql. */
export function normalizeAddress(addr: string | null | undefined, city: string | null | undefined): string | null {
  let s = `${addr ?? ""} ${city ?? ""}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const subs: [string, string][] = [
    ["street", "st"],
    ["drive", "dr"],
    ["avenue", "ave"],
    ["road", "rd"],
    ["boulevard", "blvd"],
    ["parkway", "pkwy"],
    ["highway", "hwy"],
    ["lane", "ln"],
  ];
  for (const [from, to] of subs) s = s.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  s = s.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export type AgeBand = "lt10" | "10to15" | "15to20" | "20plus" | "unknown";
export const AGE_BANDS: Record<AgeBand, string> = {
  lt10: "Under 10 yrs",
  "10to15": "10–15 yrs",
  "15to20": "15–20 yrs",
  "20plus": "20+ yrs",
  unknown: "Age unknown",
};

export function roofAge(installYear: number | null | undefined, year: number): number | null {
  return installYear ? Math.max(0, year - installYear) : null;
}

export function ageBand(installYear: number | null | undefined, year: number): AgeBand {
  const age = roofAge(installYear, year);
  if (age == null) return "unknown";
  if (age < 10) return "lt10";
  if (age < 15) return "10to15";
  if (age < 20) return "15to20";
  return "20plus";
}

/** Install-year bounds (inclusive) for a band, for the database filter. */
export function ageBandYears(band: Exclude<AgeBand, "unknown">, year: number): { min?: number; max?: number } {
  switch (band) {
    case "lt10":
      return { min: year - 9 };
    case "10to15":
      return { min: year - 14, max: year - 10 };
    case "15to20":
      return { min: year - 19, max: year - 15 };
    case "20plus":
      return { max: year - 20 };
  }
}

/** A contact is going quiet when their last touch is older than their account's tier threshold (P3 when unknown). */
export function isGoingQuiet(lastTouch: string | null | undefined, tier: number | null | undefined, now: Date): boolean {
  if (!lastTouch) return false;
  const days = (now.getTime() - new Date(lastTouch).getTime()) / 86_400_000;
  return days > (COLD_THRESHOLD_DAYS[tier ?? 3] ?? 30);
}

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}
