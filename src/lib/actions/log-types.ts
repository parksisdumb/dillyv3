// Shapes shared by the Log sheet (client) and its server actions.

export type LogTarget = {
  accountId?: string | null;
  contactId?: string | null;
  propertyId?: string | null;
  opportunityId?: string | null;
};

export type ContactOption = { id: string; name: string; title: string | null; persona_role: string; account_id: string | null; account_name?: string | null };

export type LogContextData = {
  account: { id: string; name: string } | null;
  contact: ContactOption | null;
  contacts: ContactOption[];
  properties: { id: string; label: string }[];
  opportunities: { id: string; name: string }[];
  points: Record<string, number>;
  today: string;
};

export type LogInput = LogTarget & {
  channel: string;
  outcome: string;
  notes?: string | null;
  metRole?: string | null;
  followUpOn?: string | null;
  followUpNote?: string | null;
  skipFollowUp?: boolean;
  source?: "rep" | "field";
};

export type LogResult =
  | {
      ok: true;
      touchId: string;
      points: number;
      awards: { event: string; points: number }[];
      closed: number;
      next: { title: string; due_on: string } | null;
      toast: string;
    }
  | { ok: false; error: string };

export type SimilarContact = { id: string; full_name: string | null; email: string | null; phone: string | null; account_name: string | null; similarity: number | null };

export type QuickContactInput = {
  accountId?: string | null;
  propertyId?: string | null;
  fullName: string;
  title?: string | null;
  personaRole?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: "rep" | "field";
  /** Skip the duplicate check (the rep said "No, this is someone new"). */
  force?: boolean;
};

export type QuickContactResult =
  | { ok: true; contact: ContactOption }
  | { ok: false; duplicates: SimilarContact[]; error?: undefined }
  | { ok: false; error: string; duplicates?: undefined };

export type SearchHit = { kind: "contact" | "account"; id: string; name: string; sub: string | null; accountId: string | null };
