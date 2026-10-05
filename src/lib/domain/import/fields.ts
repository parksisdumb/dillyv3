// CSV import: the fields a sheet can map to, and header auto-detection. Pure (shared by browser, server and tests).

/** HOA / COA / POA / condo / community association / homeowners association. */
export const CONDO_HOA_RE = /\b(hoas?|coas?|poas?|condos?|condominiums?|community associations?|homeowners?'? associations?|owners'? associations?|associations?)\b/;

export type Entity = "account" | "contact" | "property" | "meta";

export const FIELDS = {
  account_name: { label: "Company", entity: "account", hint: "Management company / owner / account" },
  account_type: { label: "Company type", entity: "account", hint: "PMC, owner, REIT, GC…" },
  tier: { label: "Priority tier", entity: "account", hint: "P1–P4 or 1–4" },
  account_phone: { label: "Company phone", entity: "account", hint: "" },
  website: { label: "Website", entity: "account", hint: "" },
  full_name: { label: "Contact full name", entity: "contact", hint: "Split into first / last" },
  first_name: { label: "Contact first name", entity: "contact", hint: "" },
  last_name: { label: "Contact last name", entity: "contact", hint: "" },
  title: { label: "Contact title", entity: "contact", hint: "" },
  email: { label: "Contact email", entity: "contact", hint: "" },
  phone: { label: "Contact phone", entity: "contact", hint: "" },
  mobile: { label: "Contact mobile", entity: "contact", hint: "" },
  property_name: { label: "Property name", entity: "property", hint: "Community / building" },
  address1: { label: "Street address", entity: "property", hint: "" },
  city: { label: "City", entity: "property", hint: "" },
  state: { label: "State", entity: "property", hint: "" },
  zip: { label: "Zip", entity: "property", hint: "" },
  asset_class: { label: "Asset class", entity: "property", hint: "Multifamily, office…" },
  roof_system: { label: "Roof system", entity: "property", hint: "TPO, EPDM, mod-bit…" },
  roof_year: { label: "Roof install year", entity: "property", hint: "" },
  roof_age: { label: "Roof age (years)", entity: "property", hint: "Converted to install year" },
  roof_area_sf: { label: "Roof sq ft", entity: "property", hint: "" },
  unit_count: { label: "Units", entity: "property", hint: "" },
  notes: { label: "Notes", entity: "meta", hint: "Goes on the property, else the contact, else the company" },
  rep_email: { label: "Rep email", entity: "meta", hint: "Account owner" },
} as const satisfies Record<string, { label: string; entity: Entity; hint: string }>;

export type FieldKey = keyof typeof FIELDS;
export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];

/** Column index → field. Unmapped columns are absent. */
export type Mapping = Record<number, FieldKey>;

/** Lowercase, punctuation → space, collapse. "E-mail Address" → "e mail address". */
export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[#]/g, " number ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Exact header forms (after normHeader). Checked first; everything else falls to the keyword rules below.
const EXACT: Record<string, FieldKey> = {
  company: "account_name",
  "company name": "account_name",
  account: "account_name",
  "account name": "account_name",
  "management company": "account_name",
  "mgmt company": "account_name",
  "property management company": "account_name",
  "property manager company": "account_name",
  pmc: "account_name",
  manager: "account_name",
  "managed by": "account_name",
  owner: "account_name",
  "owner name": "account_name",
  "property owner": "account_name",
  "ownership": "account_name",
  "owner entity": "account_name",
  organization: "account_name",
  hoa: "account_name",
  "hoa name": "account_name",
  "hoa management company": "account_name",
  coa: "account_name",
  poa: "account_name",
  association: "account_name",
  "association name": "account_name",
  "community association": "account_name",
  "condo association": "account_name",
  "company type": "account_type",
  "account type": "account_type",
  type: "account_type",
  tier: "tier",
  priority: "tier",
  "icp tier": "tier",
  "company phone": "account_phone",
  "main phone": "account_phone",
  "office phone": "account_phone",
  website: "website",
  "web site": "website",
  url: "website",
  "full name": "full_name",
  name: "full_name",
  contact: "full_name",
  "contact name": "full_name",
  "on site contact": "full_name",
  "onsite contact": "full_name",
  "primary contact": "full_name",
  first: "first_name",
  "first name": "first_name",
  firstname: "first_name",
  "contact first name": "first_name",
  last: "last_name",
  "last name": "last_name",
  lastname: "last_name",
  surname: "last_name",
  "contact last name": "last_name",
  title: "title",
  "job title": "title",
  position: "title",
  "contact title": "title",
  role: "title",
  email: "email",
  "e mail": "email",
  "email address": "email",
  "contact email": "email",
  phone: "phone",
  "phone number": "phone",
  "work phone": "phone",
  "direct phone": "phone",
  direct: "phone",
  "contact phone": "phone",
  telephone: "phone",
  mobile: "mobile",
  cell: "mobile",
  "cell phone": "mobile",
  "mobile phone": "mobile",
  property: "property_name",
  "property name": "property_name",
  community: "property_name",
  "community name": "property_name",
  building: "property_name",
  "building name": "property_name",
  site: "property_name",
  "site name": "property_name",
  "asset name": "property_name",
  address: "address1",
  "address 1": "address1",
  address1: "address1",
  "address line 1": "address1",
  street: "address1",
  "street address": "address1",
  "property address": "address1",
  "site address": "address1",
  city: "city",
  "property city": "city",
  state: "state",
  st: "state",
  "property state": "state",
  zip: "zip",
  "zip code": "zip",
  zipcode: "zip",
  postal: "zip",
  "postal code": "zip",
  "asset class": "asset_class",
  "asset type": "asset_class",
  "property type": "asset_class",
  "building type": "asset_class",
  roof: "roof_system",
  "roof type": "roof_system",
  "roof system": "roof_system",
  "roofing system": "roof_system",
  membrane: "roof_system",
  "roof year": "roof_year",
  "year installed": "roof_year",
  "install year": "roof_year",
  "roof install year": "roof_year",
  "roof installed": "roof_year",
  "year roof installed": "roof_year",
  "roof age": "roof_age",
  age: "roof_age",
  "roof age years": "roof_age",
  "sq ft": "roof_area_sf",
  sqft: "roof_area_sf",
  sf: "roof_area_sf",
  "square feet": "roof_area_sf",
  "square footage": "roof_area_sf",
  "roof sq ft": "roof_area_sf",
  "roof sf": "roof_area_sf",
  "roof area": "roof_area_sf",
  "roof size": "roof_area_sf",
  units: "unit_count",
  "unit count": "unit_count",
  "number units": "unit_count",
  "number of units": "unit_count",
  doors: "unit_count",
  notes: "notes",
  note: "notes",
  comments: "notes",
  comment: "notes",
  "rep email": "rep_email",
  "owner email": "rep_email",
  "account owner email": "rep_email",
  "assigned rep": "rep_email",
  "assigned to": "rep_email",
  rep: "rep_email",
  "sales rep": "rep_email",
  salesperson: "rep_email",
};

/** Keyword rules for headers not in EXACT, in priority order. */
const RULES: [RegExp, FieldKey][] = [
  [/\b(rep|salesperson|assigned|account owner)\b.*\bemail\b|\bemail\b.*\b(rep|owner)\b/, "rep_email"],
  [/\be ?mail\b/, "email"],
  [/\b(mobile|cell)\b/, "mobile"],
  [/\bfirst\b/, "first_name"],
  [/\blast\b/, "last_name"],
  [/\broof\b.*\b(year|yr|installed|install)\b|\b(year|yr|installed)\b.*\broof\b/, "roof_year"],
  [/\broof\b.*\bage\b/, "roof_age"],
  [/\b(sq ft|sqft|square f(ee|oo)t|sf)\b|\barea\b/, "roof_area_sf"],
  [/\broof\b|\bmembrane\b/, "roof_system"],
  [/\bunits?\b|\bdoors\b/, "unit_count"],
  [/\b(management|mgmt|managed|manager co|pmc)\b/, "account_name"],
  [/\b(hoa|coa|poa|association)\b/, "account_name"],
  [/\bowner\b/, "account_name"],
  [/\b(company|account|organization|firm)\b.*\bphone\b/, "account_phone"],
  [/\b(company|account|organization|firm)\b/, "account_name"],
  [/\b(community|building|property|site)\b.*\bname\b|^(community|building|property)\b/, "property_name"],
  [/\baddress\b|\bstreet\b/, "address1"],
  [/\bcity\b/, "city"],
  [/\bstate\b/, "state"],
  [/\b(zip|postal)\b/, "zip"],
  [/\bphone\b/, "phone"],
  [/\btitle\b/, "title"],
  [/\bcontact\b/, "full_name"],
  [/\bnotes?\b|\bcomments?\b/, "notes"],
];

/**
 * Guess a mapping from header names. Each field is used at most once (first column wins), so a sheet with both
 * "Owner" and "Management Company" maps the first to Company and leaves the other for the manager to decide.
 */
export function detectMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<FieldKey>();
  const guesses = headers.map((h) => guessField(h));
  // Exact matches claim their field first, then keyword matches, both in column order.
  for (const pass of ["exact", "rule"] as const) {
    guesses.forEach((g, i) => {
      if (!g || g.how !== pass || used.has(g.field) || out[i]) return;
      out[i] = g.field;
      used.add(g.field);
    });
  }
  // full_name and first/last together: keep first/last (more precise).
  if (used.has("full_name") && used.has("first_name") && used.has("last_name")) {
    for (const [i, f] of Object.entries(out)) if (f === "full_name") delete out[Number(i)];
  }
  return out;
}

export function guessField(header: string): { field: FieldKey; how: "exact" | "rule" } | null {
  const h = normHeader(header);
  if (!h) return null;
  if (EXACT[h]) return { field: EXACT[h], how: "exact" };
  for (const [re, f] of RULES) if (re.test(h)) return { field: f, how: "rule" };
  return null;
}

/**
 * Default company type for rows without one: a Company column headed like an association ("HOA", "Community
 * Association", "COA Management Company") means Condo/HOA management. Null = keep the current default.
 */
export function detectDefaultType(headers: string[], mapping: Mapping): "condo_hoa_mgmt" | null {
  const col = Object.entries(mapping).find(([, f]) => f === "account_name")?.[0];
  if (col == null) return null;
  return CONDO_HOA_RE.test(normHeader(headers[Number(col)] ?? "")) ? "condo_hoa_mgmt" : null;
}

/**
 * Which role the sheet's company plays for its properties. "Owner" columns → owner, anything else → manager
 * (the party that buys roofing for the building and drives property.account_id).
 */
export function detectPartyRole(headers: string[], mapping: Mapping): "manager" | "owner" {
  const col = Object.entries(mapping).find(([, f]) => f === "account_name")?.[0];
  if (col == null) return "manager";
  const h = normHeader(headers[Number(col)] ?? "");
  return /\bowner|ownership\b/.test(h) && !/\b(management|mgmt|managed|manager)\b/.test(h) ? "owner" : "manager";
}

/** Order-independent signature of a sheet's headers: the same export from the same system maps the same way. */
export function headerSignature(headers: string[]): string {
  return [...headers.map(normHeader).filter(Boolean)].sort().join("|");
}

/** Saved mapping (header text → field) applied to a sheet. Headers not in the saved mapping are left unmapped. */
export function applySavedMapping(headers: string[], saved: Record<string, string>): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const f = saved[normHeader(h)];
    if (f && f in FIELDS && !used.has(f)) {
      out[i] = f as FieldKey;
      used.add(f);
    }
  });
  return out;
}

/** Mapping → storable form keyed by normalized header text. */
export function mappingToSaved(headers: string[], mapping: Mapping): Record<string, FieldKey> {
  const out: Record<string, FieldKey> = {};
  for (const [i, f] of Object.entries(mapping)) {
    const h = normHeader(headers[Number(i)] ?? "");
    if (h) out[h] = f;
  }
  return out;
}

/** Which entities a mapping produces. */
export function mappedEntities(mapping: Mapping): { account: boolean; contact: boolean; property: boolean } {
  const fs = new Set(Object.values(mapping));
  const has = (e: Entity) => [...fs].some((f) => FIELDS[f].entity === e);
  return { account: fs.has("account_name"), contact: has("contact"), property: fs.has("property_name") || fs.has("address1") };
}
