// CSV import: turning raw cells into typed account / contact / property drafts, with row-level validation.
// Pure; the normalizers are TypeScript ports of the SQL ones so the browser dedupes exactly like the database.
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/vocab";
import { normalizeAddress } from "@/lib/domain/book";
import { CONDO_HOA_RE, type FieldKey, type Mapping } from "@/lib/domain/import/fields";

export { normalizeAddress };

/** Port of app.normalize_name (20261003000100_foundation.sql). Keep the regexes identical — spacing included. */
export function normalizeName(t: string | null | undefined): string | null {
  const s = (t ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|the|lp|llp)\b|\s+/g, " ")
    .trim();
  return s === "" ? null : s;
}

/** Last 10 digits of a phone number ("" when there are fewer than 10). */
export function phoneKey(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** Letters-only lowercase name for same-person comparisons. */
export function personKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

/** pg_trgm-compatible trigram set: words of alphanumerics, padded "  w ". */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm similarity(): shared trigrams / union of trigrams. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = trigrams(a ?? "");
  const y = trigrams(b ?? "");
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i;
export const isEmail = (s: string) => EMAIL_RE.test(s);

/** "186,000", "186000 sf", "1.2k" → number; "" / junk → null. */
export function parseNumber(s: string | null | undefined): number | null {
  const t = (s ?? "").trim().toLowerCase().replace(/,/g, "");
  if (!t) return null;
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (/\d\s*k\b/.test(t)) n *= 1000;
  return Number.isFinite(n) ? n : null;
}

export function parseTier(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/[1-4]/);
  return m ? Number(m[0]) : null;
}

const TYPE_WORDS: [RegExp, AccountType][] = [
  // Before property mgmt: "HOA management" / "Condo association mgmt" are associations, not PMCs.
  [CONDO_HOA_RE, "condo_hoa_mgmt"],
  [/\b(pmc|property manage|management|mgmt)\b/, "property_mgmt"],
  [/\breit\b/, "reit"],
  [/\b(gc|general contractor|contractor)\b/, "gc"],
  [/\bdevelop/, "developer"],
  [/\bbroker/, "broker"],
  [/\b(asset manage)/, "asset_mgmt"],
  [/\b(facilit)/, "facilities"],
  [/\b(school|education|university|college|isd)\b/, "education"],
  [/\b(hospital|health|medical)\b/, "healthcare"],
  [/\b(church|worship|religious)\b/, "religious"],
  [/\b(government|city of|county|municipal|federal)\b/, "government"],
  [/\b(owner|investor|ownership)\b/, "owner"],
];

export function parseAccountType(s: string | null | undefined): AccountType | null {
  const t = (s ?? "").trim().toLowerCase();
  if (!t) return null;
  const direct = t.replace(/[^a-z]+/g, "_");
  if (direct in ACCOUNT_TYPES) return direct as AccountType;
  for (const [k, v] of Object.entries(ACCOUNT_TYPES)) if (v.toLowerCase() === t) return k as AccountType;
  for (const [re, ty] of TYPE_WORDS) if (re.test(t)) return ty;
  return null;
}

const ROOFS: [RegExp, string][] = [
  [/\btpo\b/, "TPO"],
  [/\bepdm\b|rubber/, "EPDM"],
  [/\bpvc\b/, "PVC"],
  [/mod(ified)?[\s-]*bit|\bsbs\b|\bapp\b/, "Mod-bit"],
  [/\bbur\b|built[\s-]*up/, "BUR"],
  [/metal|standing seam/, "Metal"],
  [/shingle|asphalt|comp(osition)?\b/, "Shingle"],
  [/coat|silicone|acrylic/, "Coating"],
];

/** Normalize roof system names to the list the Properties filter uses; unknown values pass through trimmed. */
export function parseRoofSystem(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  for (const [re, v] of ROOFS) if (re.test(t.toLowerCase())) return v;
  return t.slice(0, 60);
}

export type AccountDraft = {
  name: string;
  norm: string;
  account_type: AccountType | null;
  icp_tier: number | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
};
export type ContactDraft = {
  first_name: string | null;
  last_name: string | null;
  full: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  notes: string | null;
};
export type PropertyDraft = {
  name: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  norm: string | null;
  asset_class: string | null;
  roof_system: string | null;
  roof_install_year: number | null;
  roof_area_sf: number | null;
  unit_count: number | null;
  notes: string | null;
};

export type RowIssue = { field?: FieldKey; message: string };

export type MappedRow = {
  index: number; // 0-based data row (sheet row = index + 2 with a header row)
  account: AccountDraft | null;
  contact: ContactDraft | null;
  property: PropertyDraft | null;
  repEmail: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
  empty: boolean;
};

const clean = (s: string | undefined | null, max = 200): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Split "Dana Whitfield", "Whitfield, Dana", "Dr. Dana M. Whitfield Jr." into first / last. */
export function splitName(full: string): { first: string | null; last: string | null } {
  let t = full.replace(/\s+/g, " ").trim();
  if (!t) return { first: null, last: null };
  if (t.includes(",")) {
    const [last, first] = t.split(",", 2).map((x) => x.trim());
    if (first && !/^(jr|sr|ii|iii|iv)\.?$/i.test(first)) return { first: first || null, last: last || null };
    t = t.replace(/,/g, "");
  }
  const parts = t.split(" ").filter((p) => !/^(mr|mrs|ms|dr)\.?$/i.test(p) && !/^(jr|sr|ii|iii|iv)\.?$/i.test(p));
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

/**
 * One sheet row → drafts + issues. `year` is the current year (roof age → install year).
 * Errors make the row skip (it needs fixing in the sheet); warnings import with the bad value dropped.
 */
export function mapRow(cells: string[], mapping: Mapping, index: number, year: number): MappedRow {
  const get = (f: FieldKey): string | null => {
    for (const [i, k] of Object.entries(mapping)) if (k === f) return clean(cells[Number(i)], f === "notes" ? 2000 : 200);
    return null;
  };
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const empty = cells.every((c) => !c || !c.trim());

  // Account
  const accountName = get("account_name");
  let account: AccountDraft | null = null;
  if (accountName) {
    const norm = normalizeName(accountName);
    if (!norm || accountName.length < 2) errors.push({ field: "account_name", message: `Company “${accountName}” is too short` });
    else {
      const typeRaw = get("account_type");
      const account_type = parseAccountType(typeRaw);
      if (typeRaw && !account_type) warnings.push({ field: "account_type", message: `Unknown company type “${typeRaw}” — using the default` });
      const tierRaw = get("tier");
      const icp_tier = parseTier(tierRaw);
      if (tierRaw && icp_tier == null) warnings.push({ field: "tier", message: `Tier “${tierRaw}” isn't P1–P4 — using the default` });
      account = { name: accountName, norm, account_type, icp_tier, phone: get("account_phone"), website: get("website"), notes: null };
    }
  }

  // Contact
  let first = get("first_name");
  let last = get("last_name");
  const fullRaw = get("full_name");
  if (fullRaw && !first && !last) ({ first, last } = splitName(fullRaw));
  const emailRaw = get("email");
  let email: string | null = null;
  if (emailRaw) {
    const e = emailRaw.toLowerCase().replace(/^mailto:/, "");
    if (isEmail(e)) email = e;
    else errors.push({ field: "email", message: `Bad email “${emailRaw}”` });
  }
  const title = get("title");
  const phone = get("phone");
  const mobile = get("mobile");
  let contact: ContactDraft | null = null;
  if (first || last || email || emailRaw) {
    contact = { first_name: first, last_name: last, full: [first, last].filter(Boolean).join(" "), title, email, phone, mobile, notes: null };
  } else if (title || phone || mobile) {
    errors.push({ field: "full_name", message: "Contact has a title or phone but no name or email" });
  }

  // Property
  const pname = get("property_name");
  const address1 = get("address1");
  const city = get("city");
  const roofRaw = get("roof_system");
  const yearRaw = get("roof_year");
  const ageRaw = get("roof_age");
  const sfRaw = get("roof_area_sf");
  const unitsRaw = get("unit_count");
  let property: PropertyDraft | null = null;
  if (pname || address1) {
    let roof_install_year: number | null = null;
    if (yearRaw) {
      const y = parseNumber(yearRaw);
      if (y != null && y >= 1900 && y <= year + 1) roof_install_year = Math.round(y);
      else warnings.push({ field: "roof_year", message: `Roof year “${yearRaw}” ignored` });
    } else if (ageRaw) {
      const a = parseNumber(ageRaw);
      if (a != null && a >= 0 && a <= 100) roof_install_year = year - Math.round(a);
      else warnings.push({ field: "roof_age", message: `Roof age “${ageRaw}” ignored` });
    }
    let roof_area_sf: number | null = null;
    if (sfRaw) {
      const n = parseNumber(sfRaw);
      if (n != null && n > 0 && n < 100_000_000) roof_area_sf = Math.round(n);
      else warnings.push({ field: "roof_area_sf", message: `Sq ft “${sfRaw}” ignored` });
    }
    let unit_count: number | null = null;
    if (unitsRaw) {
      const n = parseNumber(unitsRaw);
      if (n != null && n >= 0 && n < 100_000) unit_count = Math.round(n);
      else warnings.push({ field: "unit_count", message: `Units “${unitsRaw}” ignored` });
    }
    property = {
      name: pname,
      address1,
      city,
      state: get("state"),
      zip: get("zip"),
      norm: address1 ? normalizeAddress(address1, city) : null,
      asset_class: get("asset_class"),
      roof_system: parseRoofSystem(roofRaw),
      roof_install_year,
      roof_area_sf,
      unit_count,
      notes: null,
    };
  } else if (roofRaw || yearRaw || ageRaw || sfRaw || unitsRaw) {
    errors.push({ field: "address1", message: "Roof details but no property name or address" });
  }

  // Notes land on the most specific record in the row.
  const notes = get("notes");
  if (notes) {
    if (property) property.notes = notes;
    else if (contact) contact.notes = notes;
    else if (account) account.notes = notes;
  }

  if (!empty && !account && !contact && !property && errors.length === 0) {
    errors.push({ message: "Nothing to import — no company, contact name/email, or property name/address" });
  }

  return { index, account, contact, property, repEmail: get("rep_email"), errors, warnings, empty };
}

export function mapRows(rows: string[][], mapping: Mapping, year: number): MappedRow[] {
  return rows.map((r, i) => mapRow(r, mapping, i, year));
}
