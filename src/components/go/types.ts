import type { PropertyBadge } from "@/lib/domain/badges-property";

export type StopContact = { id: string; name: string; title: string | null; role: string };

export type Stop = {
  accountId: string;
  accountName: string;
  tier: number | null;
  propertyId: string | null;
  place: string | null; // building name
  address: string | null;
  city: string;
  reason: string | null;
  directions: string | null;
  contacts: StopContact[];
  fromQueue: boolean;
  badges?: PropertyBadge[];
  flags?: string[];
  /** Building pin (property.lat/lng, geocoded from the address). */
  lat?: number | null;
  lng?: number | null;
  /** "123 Main St, Austin, TX" for Google Maps. */
  mapsAddress?: string | null;
};

export type FocusItem = {
  key: string;
  accountId: string | null;
  contactId: string | null;
  propertyId: string | null;
  opportunityId: string | null;
  name: string;
  account: string | null;
  phone: string;
  reason: string | null;
  tier: number | null;
};

/** A stop on "My day" (Go). */
export type DayStop = Stop & {
  /** Stable key: the building, else the account. */
  key: string;
  /** "Met in person" etc. when I already logged here today. */
  logged?: string | null;
  /** From an assigned list / active pursuit (vs. the suggested fallback). */
  listName?: string | null;
};

export const stopKey = (s: Pick<Stop, "propertyId" | "accountId">) => s.propertyId ?? `acct:${s.accountId}`;
