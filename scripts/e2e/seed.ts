/**
 * E2E seed for the local Supabase-equivalent stack (scripts/local/stack).
 *
 *   npx tsx scripts/e2e/seed.ts            # seed (idempotent: wipes FOX + TSG business data, re-creates it)
 *
 * Uses the service-role key through the real gateway (PostgREST + GoTrue), so every database trigger runs exactly as in
 * production: touches close follow-ups, schedule the next one and award points.
 *
 * Idempotency: auth users are created-or-updated (password reset to E2E_PASSWORD); memberships are upserted; every
 * tenant-scoped business row for FOX and TSG is deleted and re-inserted from a fixed, seeded-random plan. Dates are
 * relative to "now", so the data always looks like the last 30 days.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANON_KEY, SERVICE_KEY } from "../local/stack/keys.mjs";

export const E2E_PASSWORD = "e2e-password-1";
export const STACK_URL = process.env.E2E_STACK_URL ?? "http://127.0.0.1:54321";
export { ANON_KEY, SERVICE_KEY };

export type PersonaKey = "parks" | "tyler" | "colby" | "kayla" | "team" | "tsgrep";
export const PERSONAS: Record<PersonaKey, { email: string; name: string }> = {
  parks: { email: "parks@foxroofing.co", name: "Parks Flowers" },
  tyler: { email: "tyler@foxroofing.co", name: "Tyler Fox" },
  colby: { email: "colby@foxroofing.co", name: "Colby Remedios" },
  kayla: { email: "kayla@foxroofing.co", name: "Kayla Smiley" },
  team: { email: "team@dillyos.com", name: "Parks Flowers" },
  tsgrep: { email: "e2e-tsg-rep@thesvcgroup.com", name: "Morgan Hale" },
};

/** Memberships the seed guarantees (mirrors the invites in 20261003000800_initial_tenants.sql + the TSG rep). */
const MEMBERSHIPS: { tenant: "fox" | "tsg"; who: PersonaKey; role: string }[] = [
  { tenant: "fox", who: "parks", role: "admin" },
  { tenant: "fox", who: "tyler", role: "manager" },
  { tenant: "fox", who: "colby", role: "rep" },
  { tenant: "fox", who: "kayla", role: "rep" },
  { tenant: "tsg", who: "team", role: "owner" },
  { tenant: "tsg", who: "tsgrep", role: "rep" },
];

export function adminClient(): SupabaseClient {
  return createClient(STACK_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------------------------------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261005);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

const DAY = 86_400_000;
const isoAgo = (days: number, hour = 10, minute = 0) => {
  const d = new Date(Date.now() - days * DAY);
  // Keep seeded activity during a Central-time workday (UTC-5 in Oct): 10:00 local = 15:00Z.
  d.setUTCHours(hour + 5, minute, 0, 0);
  if (d.getTime() > Date.now()) d.setTime(Date.now() - 5 * 60_000);
  return d.toISOString();
};
export const chicagoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
export const dayOffset = (n: number) => {
  const [y, m, d] = chicagoToday().split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};
function weekdaysBefore(n: number): string[] {
  const out: string[] = [];
  let k = 1;
  while (out.length < n) {
    const day = dayOffset(-k);
    const dow = new Date(day + "T00:00:00Z").getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(day);
    k++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------------------------
type AcctPlan = {
  key: string;
  name: string;
  type: string;
  tier: number;
  city: string;
  state: string;
  market: string;
  owner: PersonaKey | null;
  phone?: string;
  address1?: string;
  /** "never" = no touches (first touch candidate); "cold" = last touch long ago; "active" = touched in last 30d */
  life: "never" | "cold" | "active";
  onboarding?: string;
};

// FOX: 26 accounts (Austin + DFW, PMC-heavy, plus GCs, an owner, an institution)
const FOX_ACCOUNTS: AcctPlan[] = [
  { key: "greystar", name: "Greystar", type: "property_mgmt", tier: 1, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "active", phone: "(512) 555-0101", address1: "600 Congress Ave" },
  { key: "rpm", name: "RPM Living", type: "property_mgmt", tier: 1, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "active", phone: "(512) 555-0102", address1: "1717 W 6th St" },
  { key: "asset", name: "Asset Living", type: "property_mgmt", tier: 2, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "cold", phone: "(512) 555-0103", address1: "4407 Monterey Oaks Blvd" },
  { key: "cushman", name: "Cushman & Wakefield", type: "facilities", tier: 1, city: "Dallas", state: "TX", market: "dfw", owner: "kayla", life: "active", phone: "(214) 555-0104", address1: "2101 Cedar Springs Rd" },
  { key: "lincoln", name: "Lincoln Property Company", type: "property_mgmt", tier: 1, city: "Dallas", state: "TX", market: "dfw", owner: "colby", life: "active", phone: "(214) 555-0105", address1: "2000 McKinney Ave" },
  { key: "avenue5", name: "Avenue5 Residential", type: "property_mgmt", tier: 2, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "active", address1: "3300 Bee Caves Rd" },
  { key: "bell", name: "Bell Partners", type: "property_mgmt", tier: 2, city: "Fort Worth", state: "TX", market: "dfw", owner: "kayla", life: "cold", address1: "777 Main St" },
  { key: "camden", name: "Camden Property Trust", type: "reit", tier: 1, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "cold", phone: "(512) 555-0108", address1: "11 Rainey St" },
  { key: "cortland", name: "Cortland", type: "property_mgmt", tier: 2, city: "Dallas", state: "TX", market: "dfw", owner: "kayla", life: "active", address1: "1900 N Akard St" },
  { key: "missionrock", name: "Mission Rock Residential", type: "property_mgmt", tier: 3, city: "Plano", state: "TX", market: "dfw", owner: "kayla", life: "active" },
  { key: "pinnacle", name: "Pinnacle Property Management", type: "property_mgmt", tier: 2, city: "Round Rock", state: "TX", market: "austin", owner: "colby", life: "never", address1: "201 E Main St" },
  { key: "hines", name: "Hines", type: "owner", tier: 1, city: "Dallas", state: "TX", market: "dfw", owner: "tyler", life: "active", phone: "(214) 555-0112" },
  { key: "cbre", name: "CBRE Facilities", type: "facilities", tier: 2, city: "Austin", state: "TX", market: "austin", owner: "kayla", life: "active" },
  { key: "jll", name: "JLL", type: "facilities", tier: 2, city: "Dallas", state: "TX", market: "dfw", owner: "tyler", life: "cold" },
  { key: "trammell", name: "Trammell Crow Residential", type: "developer", tier: 3, city: "Dallas", state: "TX", market: "dfw", owner: null, life: "never" },
  { key: "henselphelps", name: "Hensel Phelps", type: "gc", tier: 2, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "active", phone: "(512) 555-0116" },
  { key: "rogersobrien", name: "Rogers-O'Brien Construction", type: "gc", tier: 3, city: "Dallas", state: "TX", market: "dfw", owner: "kayla", life: "never" },
  { key: "austinisd", name: "Austin ISD Facilities", type: "education", tier: 2, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "never", address1: "4000 S I-35 Frontage Rd" },
  { key: "prologis", name: "Prologis", type: "industrial", tier: 2, city: "Fort Worth", state: "TX", market: "dfw", owner: "parks", life: "active" },
  { key: "stream", name: "Stream Realty Partners", type: "asset_mgmt", tier: 3, city: "Dallas", state: "TX", market: "dfw", owner: "kayla", life: "active" },
  { key: "transwestern", name: "Transwestern", type: "property_mgmt", tier: 3, city: "Austin", state: "TX", market: "austin", owner: "colby", life: "never" },
  { key: "embrey", name: "Embrey Partners", type: "developer", tier: 3, city: "San Antonio", state: "TX", market: "san-antonio", owner: "parks", life: "cold" },
  { key: "weidner", name: "Weidner Apartment Homes", type: "property_mgmt", tier: 3, city: "Austin", state: "TX", market: "austin", owner: "kayla", life: "active" },
  { key: "nrp", name: "The NRP Group", type: "developer", tier: 4, city: "San Antonio", state: "TX", market: "san-antonio", owner: null, life: "never" },
  { key: "sterling", name: "Sterling Roofing Supply", type: "vendor", tier: 4, city: "Austin", state: "TX", market: "austin", owner: "tyler", life: "active", onboarding: "compliant" },
  { key: "bswhealth", name: "Baylor Scott & White Facilities", type: "healthcare", tier: 2, city: "Plano", state: "TX", market: "dfw", owner: "kayla", life: "cold" },
];

const TSG_ACCOUNTS: AcctPlan[] = [
  { key: "t-mid", name: "Mid-America Apartment Communities", type: "reit", tier: 1, city: "Memphis", state: "TN", market: "memphis", owner: "tsgrep", life: "active", phone: "(901) 555-0201", address1: "6815 Poplar Ave" },
  { key: "t-highwoods", name: "Highwoods Memphis", type: "owner", tier: 2, city: "Memphis", state: "TN", market: "memphis", owner: "tsgrep", life: "active" },
  { key: "t-loeb", name: "Loeb Properties", type: "owner", tier: 2, city: "Memphis", state: "TN", market: "memphis", owner: "tsgrep", life: "never", address1: "1060 N Garland St" },
  { key: "t-fogelman", name: "Fogelman Properties", type: "property_mgmt", tier: 1, city: "Memphis", state: "TN", market: "memphis", owner: "tsgrep", life: "cold" },
  { key: "t-boyle", name: "Boyle Investment Company", type: "developer", tier: 3, city: "Memphis", state: "TN", market: "memphis", owner: "team", life: "active" },
  { key: "t-mcs", name: "Memphis-Shelby County Schools", type: "education", tier: 2, city: "Memphis", state: "TN", market: "memphis", owner: "team", life: "never" },
  { key: "t-cbre", name: "CBRE Memphis", type: "facilities", tier: 2, city: "Memphis", state: "TN", market: "memphis", owner: "tsgrep", life: "active" },
  { key: "t-methodist", name: "Methodist Le Bonheur Facilities", type: "healthcare", tier: 2, city: "Germantown", state: "TN", market: "memphis", owner: "tsgrep", life: "active" },
  { key: "t-ffg", name: "First Horizon Properties", type: "owner", tier: 3, city: "Memphis", state: "TN", market: "memphis", owner: "team", life: "cold" },
  { key: "t-belz", name: "Belz Enterprises", type: "owner", tier: 3, city: "Memphis", state: "TN", market: "memphis", owner: null, life: "never" },
];

const FIRST = ["Dana", "Marcus", "Priya", "Luis", "Hannah", "Derek", "Tasha", "Owen", "Mei", "Caleb", "Rosa", "Grant", "Imani", "Trevor", "Leah", "Andre", "Kristen", "Victor", "Brooke", "Hector", "Shauna", "Wes", "Nadia", "Cody", "Jill", "Ramon", "Erin", "Damon", "Paige", "Felix"];
const LAST = ["Whitfield", "Okafor", "Raman", "Delgado", "Brenner", "Castillo", "Pruitt", "Nakamura", "Holloway", "Vance", "Iverson", "Salazar", "McAllister", "Quintero", "Abernathy", "Kowalski", "Fairbanks", "Tran", "Garrison", "Ellery", "Booker", "Lindqvist", "Ochoa", "Pemberton", "Rhodes", "Stanfield", "Yates", "Zamora", "Hargrove", "Duval"];
const TITLES: Record<string, string[]> = {
  economic_buyer: ["Regional Vice President", "Director of Property Operations", "VP Asset Management", "Owner"],
  evaluator: ["Regional Maintenance Director", "Facilities Manager", "Director of Engineering"],
  initiator: ["Community Manager", "Property Manager", "Assistant Property Manager"],
  influencer: ["Maintenance Supervisor", "Project Manager", "Construction Manager"],
  gatekeeper: ["Leasing Consultant", "Office Administrator", "Front Desk"],
  user: ["Maintenance Technician", "Chief Engineer"],
  unknown: ["—"],
};
const PERSONA_MIX = ["economic_buyer", "evaluator", "initiator", "initiator", "influencer", "gatekeeper", "user", "evaluator"] as const;
const ROOFS = ["TPO", "TPO", "TPO", "EPDM", "PVC", "Mod-bit", "BUR", "Metal", "Shingle", "Coating"];
const STREETS = ["Lamar Blvd", "Burnet Rd", "Riverside Dr", "Parmer Ln", "Slaughter Ln", "Mopac Expy", "Lemmon Ave", "Greenville Ave", "Preston Rd", "Belt Line Rd", "Camp Bowie Blvd", "Legacy Dr"];
const PROP_NAMES = ["The Monroe", "Elan Parkside", "Bluebonnet Flats", "Cedar Ridge", "The Vue", "Lakeline Station", "Mueller Lofts", "Domain Heights", "Trinity Commons", "Bishop Arts Place", "Uptown West", "Stockyards Lofts", "Legacy Point", "Riverbend", "Oak Hollow", "Hill Country Commons", "Canyon Creek", "Pecan Grove", "Sixth Street Lofts", "Highland Mall Annex"];

// ---------------------------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------------------------
async function ensureUser(sb: SupabaseClient, email: string, fullName: string): Promise<string> {
  // GoTrue admin: list (small set locally) then create or update.
  const { data: list, error: lerr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (lerr) throw new Error(`listUsers: ${lerr.message}`);
  const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    const { error } = await sb.auth.admin.updateUserById(found.id, { password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error) throw new Error(`updateUser ${email}: ${error.message}`);
    return found.id;
  }
  const { data, error } = await sb.auth.admin.createUser({ email, password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as NonNullable<T>;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------------------------
export type SeedResult = {
  tenants: { fox: string; tsg: string };
  users: Record<PersonaKey, string>;
  accounts: Record<string, string>;
  stalledProposalId: string;
};

export async function seed(log: (m: string) => void = console.log): Promise<SeedResult> {
  const sb = adminClient();
  const t0 = Date.now();

  const tenants = await must(sb.from("tenant").select("id,slug"), "tenants");
  const fox = tenants.find((t) => t.slug === "fox")?.id;
  const tsg = tenants.find((t) => t.slug === "tsg")?.id;
  if (!fox || !tsg) throw new Error("FOX/TSG tenants missing — run scripts/local/stack/up.sh --fresh (migrations seed them).");
  const markets = await must(sb.from("market").select("id,slug"), "markets");
  const marketId = (slug: string) => markets.find((m) => m.slug === slug)?.id ?? null;

  // --- users + memberships --------------------------------------------------------------------------------------
  const users = {} as Record<PersonaKey, string>;
  for (const [k, p] of Object.entries(PERSONAS) as [PersonaKey, { email: string; name: string }][]) {
    users[k] = await ensureUser(sb, p.email, p.name);
  }
  // The TSG rep is not in the migration roster: invite them (service role) like an owner would.
  await must(
    sb.from("invite").upsert({ tenant_id: tsg, email: PERSONAS.tsgrep.email, role: "rep", full_name: PERSONAS.tsgrep.name }, { onConflict: "tenant_id,email" }),
    "tsg rep invite",
  );
  for (const [k, id] of Object.entries(users) as [PersonaKey, string][]) {
    await must(sb.from("profile").update({ full_name: PERSONAS[k].name }).eq("id", id), "profile name");
  }
  await must(
    sb.from("membership").upsert(
      MEMBERSHIPS.map((m) => ({ tenant_id: m.tenant === "fox" ? fox : tsg, user_id: users[m.who], role: m.role, active: true })),
      { onConflict: "tenant_id,user_id" },
    ),
    "memberships",
  );
  // Invites for seeded people are claimed; Ben + Dylan stay unclaimed (they haven't signed in yet).
  await must(
    sb.from("invite").update({ claimed_at: new Date().toISOString() }).in("email", Object.values(PERSONAS).map((p) => p.email)),
    "claim seeded invites",
  );
  // Ben and Dylan exist in auth (so auth specs can sign in) but have never opened the app: no membership, unclaimed
  // invite. Their first page load must claim the FOX invite (public.claim_invites()).
  for (const [email, full] of [
    ["ben@foxroofing.co", "Ben Mitchell"],
    ["dylan@foxroofing.co", "Dylan Kreiser"],
  ] as const) {
    const id = await ensureUser(sb, email, full);
    await must(sb.from("membership").delete().eq("user_id", id), `reset ${email} membership`);
  }
  await must(sb.from("invite").update({ claimed_at: null }).in("email", ["ben@foxroofing.co", "dylan@foxroofing.co"]), "unclaim ben/dylan");

  // --- wipe tenant business data --------------------------------------------------------------------------------
  const both = [fox, tsg];
  for (const table of [
    "approval",
    "brief",
    "rep_day",
    "point_event",
    "insight",
    "task",
    "photo",
    "touch",
    "opportunity",
    "property_contact",
    "account_preference",
    "account_assignment",
    "signal",
    "property",
    "contact",
    "account",
  ]) {
    const { error } = await sb.from(table).delete().in("tenant_id", both);
    if (error) throw new Error(`wipe ${table}: ${error.message}`);
  }
  // Settings back to the migration defaults (tests may set a team goal).
  const defaults = { weekend_reminders: false, quiet_hours: ["19:00", "07:00"], max_pushes_per_day: 3 };
  await must(sb.from("tenant").update({ settings: defaults }).in("id", both), "tenant settings");

  // --- accounts ---------------------------------------------------------------------------------------------------
  const accounts: Record<string, string> = {};
  const plans = [...FOX_ACCOUNTS.map((a) => ({ ...a, tenant: fox })), ...TSG_ACCOUNTS.map((a) => ({ ...a, tenant: tsg }))];
  const inserted = await must(
    sb
      .from("account")
      .insert(
        plans.map((a) => ({
          tenant_id: a.tenant,
          name: a.name,
          account_type: a.type,
          icp_tier: a.tier,
          city: a.city,
          state: a.state,
          address1: a.address1 ?? null,
          phone: a.phone ?? null,
          market_id: marketId(a.market),
          owner_user_id: a.owner ? users[a.owner] : null,
          source: "import",
          legacy_table: "e2e_seed",
          legacy_id: a.key,
          created_by: users.parks,
        })),
      )
      .select("id,legacy_id"),
    "accounts",
  );
  for (const r of inserted) accounts[r.legacy_id!] = r.id;

  // --- contacts (FOX 80, TSG 16) ----------------------------------------------------------------------------------
  type C = { id?: string; key: string; tenant: string; account: string; first: string; last: string; persona: string; title: string; email: string | null; phone: string | null };
  const contacts: C[] = [];
  const usedNames = new Set<string>();
  const name = () => {
    for (;;) {
      const f = pick(FIRST);
      const l = pick(LAST);
      if (!usedNames.has(f + l)) {
        usedNames.add(f + l);
        return [f, l] as const;
      }
    }
  };
  const fixedFox: { acct: string; first: string; last: string; persona: string; title: string }[] = [
    // Fixed, well-known people tests can rely on.
    { acct: "greystar", first: "Dana", last: "Whitfield", persona: "economic_buyer", title: "Regional Vice President" },
    { acct: "lincoln", first: "Marcus", last: "Okafor", persona: "economic_buyer", title: "VP Asset Management" },
    { acct: "rpm", first: "Priya", last: "Raman", persona: "evaluator", title: "Regional Maintenance Director" },
  ];
  for (const f of fixedFox) usedNames.add(f.first + f.last);
  const domain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".com";
  for (const f of fixedFox) {
    const acctName = FOX_ACCOUNTS.find((a) => a.key === f.acct)!.name;
    contacts.push({
      key: `${f.first}-${f.last}`.toLowerCase(),
      tenant: fox,
      account: accounts[f.acct]!,
      first: f.first,
      last: f.last,
      persona: f.persona,
      title: f.title,
      email: `${f.first}.${f.last}@${domain(acctName)}`.toLowerCase(),
      phone: `(512) 555-${String(1000 + contacts.length).slice(-4)}`,
    });
  }
  let i = 0;
  while (contacts.length < 80) {
    const a = FOX_ACCOUNTS[i % FOX_ACCOUNTS.length]!;
    i++;
    const [f, l] = name();
    const persona = PERSONA_MIX[i % PERSONA_MIX.length]!;
    contacts.push({
      key: `fox-c${contacts.length}`,
      tenant: fox,
      account: accounts[a.key]!,
      first: f,
      last: l,
      persona,
      title: pick(TITLES[persona]!),
      email: rand() < 0.85 ? `${f}.${l}@${domain(a.name)}`.toLowerCase() : null,
      phone: rand() < 0.8 ? `(${a.city === "Austin" || a.city === "Round Rock" ? "512" : "214"}) 555-${String(2000 + contacts.length).slice(-4)}` : null,
    });
  }
  for (let k = 0; k < 16; k++) {
    const a = TSG_ACCOUNTS[k % TSG_ACCOUNTS.length]!;
    const [f, l] = name();
    const persona = PERSONA_MIX[k % PERSONA_MIX.length]!;
    contacts.push({
      key: `tsg-c${k}`,
      tenant: tsg,
      account: accounts[a.key]!,
      first: f,
      last: l,
      persona,
      title: pick(TITLES[persona]!),
      email: `${f}.${l}@${domain(a.name)}`.toLowerCase(),
      phone: `(901) 555-${String(3000 + k).slice(-4)}`,
    });
  }
  const cIns = await must(
    sb
      .from("contact")
      .insert(
        contacts.map((c) => ({
          tenant_id: c.tenant,
          account_id: c.account,
          first_name: c.first,
          last_name: c.last,
          title: c.title,
          persona_role: c.persona,
          email: c.email,
          phone: c.phone,
          source: "import",
          legacy_table: "e2e_seed",
          legacy_id: c.key,
          created_by: users.parks,
        })),
      )
      .select("id,legacy_id"),
    "contacts",
  );
  const cId = new Map(cIns.map((r) => [r.legacy_id!, r.id]));
  for (const c of contacts) c.id = cId.get(c.key);

  // --- properties (FOX 60, TSG 10) --------------------------------------------------------------------------------
  const props: Record<string, unknown>[] = [];
  const foxWithProps = FOX_ACCOUNTS.filter((a) => a.type !== "vendor" && a.type !== "gc");
  for (let k = 0; k < 60; k++) {
    const a = foxWithProps[k % foxWithProps.length]!;
    const year = int(1998, 2023);
    const warranty = rand() < 0.3 ? dayOffset(int(20, 330)) : rand() < 0.5 ? dayOffset(-int(30, 900)) : null;
    const incomplete = k % 11 === 5;
    props.push({
      tenant_id: fox,
      account_id: accounts[a.key],
      name: `${PROP_NAMES[k % PROP_NAMES.length]}${k >= PROP_NAMES.length ? ` ${Math.floor(k / PROP_NAMES.length) + 1}` : ""}`,
      address1: k === 0 ? "4801 Burnet Rd" : `${int(100, 9800)} ${pick(STREETS)}`,
      city: a.city,
      state: "TX",
      zip: a.city === "Austin" ? "787" + int(10, 59) : "752" + int(10, 99),
      market_id: marketId(a.market),
      asset_class: a.type === "industrial" ? "industrial" : a.type === "education" ? "k-12" : a.type === "healthcare" ? "healthcare" : rand() < 0.75 ? "multifamily" : "office",
      roof_system: incomplete ? null : pick(ROOFS),
      roof_area_sf: incomplete ? null : int(18, 240) * 1000,
      roof_install_year: year,
      warranty_expires_on: warranty,
      building_count: int(1, 14),
      source: "import",
      legacy_table: "e2e_seed",
      legacy_id: `fox-p${k}`,
      created_by: users.parks,
    });
  }
  for (let k = 0; k < 10; k++) {
    const a = TSG_ACCOUNTS[k]!;
    props.push({
      tenant_id: tsg,
      account_id: accounts[a.key],
      name: `${a.name.split(" ")[0]} ${["Poplar Plaza", "Ridgeway Center", "Germantown Commons", "Overton Square", "Wolfchase Flats"][k % 5]}`,
      address1: `${int(100, 7900)} ${pick(["Poplar Ave", "Union Ave", "Summer Ave", "Winchester Rd", "Germantown Pkwy"])}`,
      city: a.city,
      state: "TN",
      market_id: marketId("memphis"),
      asset_class: "multifamily",
      roof_system: pick(ROOFS),
      roof_area_sf: int(20, 150) * 1000,
      roof_install_year: int(1995, 2020),
      source: "import",
      legacy_table: "e2e_seed",
      legacy_id: `tsg-p${k}`,
      created_by: users.team,
    });
  }
  const pIns = await must(sb.from("property").insert(props).select("id,account_id,legacy_id"), "properties");
  const propByAcct = new Map<string, string>();
  for (const p of pIns) if (p.account_id && !propByAcct.has(p.account_id)) propByAcct.set(p.account_id, p.id);
  // A couple of contact↔property links.
  const dana = contacts.find((c) => c.key === "dana-whitfield")!;
  await must(
    sb.from("property_contact").insert([{ tenant_id: fox, property_id: propByAcct.get(accounts.greystar!)!, contact_id: dana.id!, role: "Regional VP" }]),
    "property_contact",
  );

  // --- opportunities ----------------------------------------------------------------------------------------------
  type O = { key: string; acct: string; name: string; stage: string; value: number; owner: PersonaKey; stageDaysAgo: number; nextStep?: string; nextDue?: number; service?: string; contact?: string; lostReason?: string };
  const opps: O[] = [
    { key: "lincoln-proposal", acct: "lincoln", name: "Lincoln — Preston Hollow Bldg 4 TPO re-roof", stage: "proposal_sent", value: 160000, owner: "colby", stageDaysAgo: 53, nextStep: "Call Marcus on proposal decision", nextDue: -20, service: "re_roof", contact: "marcus-okafor" },
    { key: "greystar-repair", acct: "greystar", name: "Greystar — The Monroe leak repairs", stage: "inspection_scheduled", value: 18500, owner: "colby", stageDaysAgo: 3, nextStep: "Roof walk with Dana", nextDue: 2, contact: "dana-whitfield" },
    { key: "rpm-maint", acct: "rpm", name: "RPM — portfolio maintenance program", stage: "contacted", value: 42000, owner: "colby", stageDaysAgo: 6, nextStep: "Send maintenance program deck", nextDue: 1, service: "maintenance" },
    { key: "avenue5-coat", acct: "avenue5", name: "Avenue5 — Mueller Lofts coating", stage: "inspection_complete", value: 67000, owner: "colby", stageDaysAgo: 4, nextStep: "Build coating proposal", nextDue: 3, service: "coating" },
    { key: "hensel-ti", acct: "henselphelps", name: "Hensel Phelps — Domain TI roofing package", stage: "lead", value: 230000, owner: "colby", stageDaysAgo: 2, nextStep: "Get on bid list", nextDue: 5, service: "tenant_improvement" },
    { key: "cushman-emerg", acct: "cushman", name: "Cushman — Cedar Springs emergency leak", stage: "negotiation", value: 24000, owner: "kayla", stageDaysAgo: 9, nextStep: "Final pricing call", nextDue: 1, service: "emergency" },
    { key: "cortland-reroof", acct: "cortland", name: "Cortland — Uptown West re-roof", stage: "proposal_sent", value: 310000, owner: "kayla", stageDaysAgo: 8, nextStep: "Proposal review meeting", nextDue: 4, service: "re_roof" },
    { key: "hines-insp", acct: "hines", name: "Hines — portfolio inspections", stage: "contacted", value: 12000, owner: "tyler", stageDaysAgo: 20, nextStep: "Confirm inspection scope", nextDue: -2, service: "inspection" },
    { key: "prologis-repair", acct: "prologis", name: "Prologis — Alliance DC repairs", stage: "inspection_scheduled", value: 55000, owner: "parks", stageDaysAgo: 5, nextStep: "Inspection Thursday", nextDue: 4 },
    { key: "weidner-lead", acct: "weidner", name: "Weidner — Riverbend repairs", stage: "lead", value: 9000, owner: "kayla", stageDaysAgo: 12, nextStep: "Intro call", nextDue: 0 },
    { key: "greystar-won", acct: "greystar", name: "Greystar — Elan Parkside repairs", stage: "won", value: 27500, owner: "colby", stageDaysAgo: 15 },
    { key: "stream-lost", acct: "stream", name: "Stream — Legacy Point re-cover", stage: "lost", value: 140000, owner: "kayla", stageDaysAgo: 18, lostReason: "Went with low bid" },
    { key: "t-mid-repair", acct: "t-mid", name: "MAA — Poplar Plaza leak repairs", stage: "proposal_sent", value: 21000, owner: "tsgrep", stageDaysAgo: 6, nextStep: "Follow up on repair quote", nextDue: 1 },
    { key: "t-cbre-maint", acct: "t-cbre", name: "CBRE Memphis — maintenance agreement", stage: "contacted", value: 36000, owner: "tsgrep", stageDaysAgo: 3, nextStep: "Walk two buildings", nextDue: 3, service: "maintenance" },
  ];
  const oIns = await must(
    sb
      .from("opportunity")
      .insert(
        opps.map((o) => ({
          tenant_id: o.acct.startsWith("t-") ? tsg : fox,
          account_id: accounts[o.acct],
          property_id: propByAcct.get(accounts[o.acct]!) ?? null,
          primary_contact_id: o.contact ? cId.get(o.contact) ?? null : null,
          name: o.name,
          stage: o.stage,
          service_line: o.service ?? "repair",
          value_estimate: o.value,
          gross_profit_estimate: Math.round(o.value * 0.3),
          next_step: o.nextStep ?? null,
          next_step_due: o.nextDue == null ? null : dayOffset(o.nextDue),
          owner_user_id: users[o.owner],
          stage_changed_at: isoAgo(o.stageDaysAgo, 9),
          won_at: o.stage === "won" ? isoAgo(o.stageDaysAgo, 9) : null,
          lost_at: o.stage === "lost" ? isoAgo(o.stageDaysAgo, 9) : null,
          lost_reason: o.lostReason ?? null,
          source: "rep",
          legacy_table: "e2e_seed",
          legacy_id: o.key,
          created_by: users[o.owner],
          created_at: isoAgo(o.stageDaysAgo + 10, 9),
        })),
      )
      .select("id,legacy_id"),
    "opportunities",
  );
  const oppId = new Map(oIns.map((r) => [r.legacy_id!, r.id]));

  // --- touches over the last 30 days (chronological so the follow-up engine runs like real life) ----------------
  type T = { tenant: string; user: PersonaKey; acct: string; contact: string | null; channel: string; outcome: string; daysAgo: number; hour: number; opp?: string; notes?: string };
  const touches: T[] = [];
  const peopleOf = (acctId: string) => contacts.filter((c) => c.account === acctId);
  const CH_OUT: [string, string][] = [
    ["call", "voicemail"],
    ["call", "connected"],
    ["call", "no_answer"],
    ["email", "sent"],
    ["email", "replied"],
    ["site_visit", "met_in_person"],
    ["door_knock", "gatekeeper"],
    ["site_visit", "met_decision_maker"],
    ["call", "call_back_later"],
    ["text", "sent"],
  ];
  for (const a of plans) {
    if (a.life === "never" || !a.owner) continue;
    const acctId = accounts[a.key]!;
    const ppl = peopleOf(acctId);
    const days = a.life === "cold" ? [int(35, 44), int(26, 33)] : [int(14, 29), int(5, 13), int(1, 4)];
    for (const d of days.sort((x, y) => y - x)) {
      const [channel, outcome] = pick(CH_OUT);
      const contact = ppl.length && rand() < 0.85 ? pick(ppl).id! : null;
      touches.push({ tenant: a.tenant, user: a.owner, acct: acctId, contact, channel, outcome, daysAgo: d, hour: int(8, 15) });
    }
  }
  // Today's activity (so Pace "touches today" is non-zero) + this week's.
  const todayActs: [PersonaKey, string, string, string][] = [
    ["kayla", "cushman", "call", "connected"],
    ["kayla", "cortland", "email", "sent"],
    ["tyler", "hines", "call", "voicemail"],
    ["colby", "rpm", "site_visit", "met_in_person"],
  ];
  for (const [u, acctKey, ch, out] of todayActs) {
    const acctId = accounts[acctKey]!;
    const ppl = peopleOf(acctId);
    touches.push({ tenant: fox, user: u, acct: acctId, contact: ppl[0]?.id ?? null, channel: ch, outcome: out, daysAgo: 0, hour: -6 /* resolved below */ });
  }
  // The stalled proposal had its last real touch long ago.
  touches.push({ tenant: fox, user: "colby", acct: accounts.lincoln!, contact: cId.get("marcus-okafor")!, channel: "email", outcome: "sent", daysAgo: 52, hour: 9, opp: "lincoln-proposal", notes: "Sent proposal PDF + warranty options" });
  touches.sort((x, y) => y.daysAgo - x.daysAgo || x.hour - y.hour);

  let todayIdx = 0;
  for (const t of touches) {
    // Today's touches land in the last half hour, oldest first.
    const occurred = t.daysAgo === 0 ? new Date(Date.now() - (30 - 5 * todayIdx++) * 60_000).toISOString() : isoAgo(t.daysAgo, t.hour, int(0, 59));
    const { error } = await sb.from("touch").insert({
      tenant_id: t.tenant,
      user_id: users[t.user],
      account_id: t.acct,
      contact_id: t.contact,
      opportunity_id: t.opp ? oppId.get(t.opp) ?? null : null,
      channel: t.channel,
      outcome: t.outcome,
      notes: t.notes ?? (rand() < 0.3 ? pick(["Ponding on the west side", "Asked for a COI", "Roof 15+ yrs, leaks in bldg 3", "Wants pricing before budget season", "Talked warranty options"]) : null),
      occurred_at: occurred,
      source: "rep",
    });
    if (error) throw new Error(`touch: ${error.message}`);
  }
  // The lincoln proposal is in proposal_sent for 53 days: the touch above flipped nothing (stage only moves from lead),
  // but restore its stage clock in case a trigger touched it.
  await must(sb.from("opportunity").update({ stage_changed_at: isoAgo(53, 9) }).eq("id", oppId.get("lincoln-proposal")!), "stall clock");

  // Asset Living (Colby, P2) and Bell Partners (Kayla, P2) went cold with nothing scheduled → "Re-engage" queue items.
  await must(
    sb.from("task").update({ status: "dropped" }).in("account_id", [accounts.asset!, accounts.bell!]).eq("status", "open"),
    "re-engage setup",
  );

  // --- explicit open tasks (incl. overdue) -------------------------------------------------------------------------
  const explicitTasks = [
    { who: "colby" as PersonaKey, acct: "greystar", contact: "dana-whitfield", title: "Send COI + W-9 to Dana", kind: "custom", due: -3 },
    { who: "colby" as PersonaKey, acct: "camden", contact: null, title: "Re-intro at Camden after the PM change", kind: "follow_up", due: -6 },
    { who: "colby" as PersonaKey, acct: "rpm", contact: "priya-raman", title: "Follow up with Priya Raman on maintenance deck", kind: "follow_up", due: 0 },
    { who: "kayla" as PersonaKey, acct: "cushman", contact: null, title: "Drop off leave-behind at Cushman", kind: "custom", due: -1 },
    { who: "tyler" as PersonaKey, acct: "hines", contact: null, title: "Review Hines inspection scope", kind: "custom", due: 0 },
    { who: "tsgrep" as PersonaKey, acct: "t-mid", contact: null, title: "Confirm MAA repair walk", kind: "follow_up", due: -2 },
  ];
  await must(
    sb.from("task").insert(
      explicitTasks.map((t) => ({
        tenant_id: t.who === "tsgrep" ? tsg : fox,
        assignee_user_id: users[t.who],
        account_id: accounts[t.acct],
        contact_id: t.contact ? cId.get(t.contact) ?? null : null,
        kind: t.kind,
        title: t.title,
        reason: t.due < 0 ? "Promised last week" : "From your call notes",
        due_on: dayOffset(t.due),
        priority: 60,
        source: "rep",
        created_by: users[t.who],
        created_at: isoAgo(Math.max(1, 1 - t.due + 2), 9),
      })),
    ),
    "explicit tasks",
  );

  // --- streak history: Colby cleared the last 3 weekdays -----------------------------------------------------------
  const days = weekdaysBefore(3);
  await must(
    sb.from("rep_day").insert(
      days.map((day) => ({ tenant_id: fox, user_id: users.colby, day, touches: 6, first_touches: 1, in_person: 2, points: 18, tasks_completed: 4, overdue_eod: 0, cleared: true })),
    ),
    "rep_day",
  );

  // --- a Daily Brief for Kayla only (Colby has none: Today must work without it) ---------------------------------
  await must(
    sb.from("brief").insert({
      tenant_id: fox,
      user_id: users.kayla,
      for_date: chicagoToday(),
      headline: "Cortland's $310K re-roof decision is this week",
      lines: [
        { kind: "one_thing", text: "Lock the Cortland proposal review before Thursday." },
        { kind: "due", text: "Cushman leave-behind is a day late." },
        { kind: "new", text: "Two Plano properties hit 20-year roofs." },
      ],
      queue: [],
    }),
    "brief",
  );

  log(`seed: ${plans.length} accounts, ${contacts.length} contacts, ${props.length} properties, ${opps.length} opps, ${touches.length} touches in ${Date.now() - t0}ms`);
  return { tenants: { fox, tsg }, users, accounts, stalledProposalId: oppId.get("lincoln-proposal")! };
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
