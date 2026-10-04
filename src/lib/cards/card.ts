// Business-card fields: the JSON contract with the vision model, and the cleanup before the form sees it. Pure.
import { z } from "zod";

const field = z.string().max(300).nullish();

/** What the model must return (validated; one retry with the error fed back — see Llm.complete({ json })). */
export const cardSchema = z.object({
  is_business_card: z.boolean().optional(),
  first_name: field,
  last_name: field,
  title: field,
  company: field,
  email: field,
  phone: field,
  mobile: field,
  website: field,
  address: field,
});
export type CardRaw = z.infer<typeof cardSchema>;

export type CardFields = {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  address: string | null;
};

const clean = (s: string | null | undefined, max = 120): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^(n\/?a|none|null|unknown|-+)$/i.test(t)) return null;
  return t.slice(0, max);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** US-style numbers → "(512) 555-0134"; anything else (extensions, international) kept as printed. */
export function formatPhone(s: string | null | undefined): string | null {
  const t = clean(s, 40);
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10 && !/x|ext/i.test(t)) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return digits.length >= 7 ? t : null;
}

export function normalizeCard(raw: CardRaw): CardFields {
  let first = clean(raw.first_name, 60);
  let last = clean(raw.last_name, 60);
  // Models sometimes put the whole name in first_name.
  if (first && !last && first.includes(" ")) {
    const parts = first.split(" ");
    last = parts.pop() ?? null;
    first = parts.join(" ");
  }
  const emailRaw = clean(raw.email, 200)?.replace(/^mailto:/i, "").toLowerCase() ?? null;
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : null;
  const phone = formatPhone(raw.phone);
  let mobile = formatPhone(raw.mobile);
  if (mobile && mobile === phone) mobile = null;
  const website = clean(raw.website, 200)?.replace(/^https?:\/\//i, "").replace(/\/$/, "") ?? null;
  return {
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(" ") || null,
    title: clean(raw.title),
    company: clean(raw.company, 200),
    email,
    phone: phone ?? mobile,
    mobile: phone ? mobile : null,
    website,
    address: clean(raw.address, 300),
  };
}

/** Nothing usable came back: treat like an unreadable photo. */
export function isEmptyCard(c: CardFields): boolean {
  return !c.full_name && !c.email && !c.phone && !c.company;
}

/** Mirrors app.normalize_name (SQL): lowercase, punctuation → space, drop company suffixes, collapse spaces. */
export function normalizeCompany(name: string | null | undefined): string | null {
  const t = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|the|lp|llp)\b|\s+/g, " ")
    .trim();
  return t || null;
}

/** Website / address have no contact columns: they go into the contact's notes. */
export function cardNotes(c: CardFields): string | null {
  const parts = [c.website ? `Web: ${c.website}` : null, c.address ? `Address: ${c.address}` : null].filter(Boolean);
  return parts.length ? `From business card — ${parts.join(" · ")}` : null;
}
