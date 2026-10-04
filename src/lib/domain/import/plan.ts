// CSV import: dedupe planning. Pure — runs in the browser for the preview and in tests.
//
// Dedupe rules (in the sheet AND against what the tenant already has):
//   accounts   — normalized name (app.normalize_name: case, punctuation, Inc/LLC/Co/The… ignored).
//   contacts   — the find_similar_contacts signals, strict enough to link automatically:
//                email exact (case-insensitive) → same person;
//                phone or mobile, last 10 digits equal → same person;
//                name trigram similarity ≥ 0.6 within the SAME company → same person.
//   properties — normalized street address + city (app.normalize_address); without an address, same name in the
//                same company.
// Matched records default to "link" (nothing about them changes; the new rows attach to them), new ones to "create".
import type { AccountType } from "@/lib/domain/vocab";
import type { AccountDraft, ContactDraft, MappedRow, PropertyDraft } from "@/lib/domain/import/rows";
import { personKey, phoneKey, similarity } from "@/lib/domain/import/rows";

export const NAME_MATCH = 0.6;

export type Action = "create" | "link" | "skip";

export type ExistingIndex = {
  accounts: { id: string; name: string; normalized_name: string | null; owner_user_id: string | null }[];
  contacts: { id: string; full_name: string | null; email: string | null; phone_digits: string | null; account_id: string | null }[];
  properties: { id: string; name: string | null; address1: string | null; city: string | null; normalized_address: string | null; account_id: string | null }[];
};

export type Member = { user_id: string; email: string; name: string };

export type PlanOptions = {
  /** Owner for new accounts without a usable rep column value. null = unassigned. */
  defaultOwnerId: string | null;
  members: Member[];
  defaultType: AccountType;
  partyRole: "manager" | "owner";
};

export type Match = { id: string; label: string; why: string };

export type PlanAccount = { key: string; draft: AccountDraft; match: Match | null; action: Action; ownerId: string | null; rows: number[] };
export type PlanContact = { key: string; draft: ContactDraft; accountKey: string | null; match: Match | null; action: Action; rows: number[] };
export type PlanProperty = { key: string; draft: PropertyDraft; accountKey: string | null; contactKeys: string[]; match: Match | null; action: Action; rows: number[] };
export type PlanRow = {
  index: number;
  accountKey: string | null;
  contactKey: string | null;
  propertyKey: string | null;
  errors: MappedRow["errors"];
  warnings: MappedRow["warnings"];
  /** Rows with errors are skipped unless the manager includes them (bad values are dropped). */
  skip: boolean;
  empty: boolean;
  /** Repeats a record already seen earlier in the sheet. */
  dupeOf: number | null;
};

export type Plan = {
  accounts: PlanAccount[];
  contacts: PlanContact[];
  properties: PlanProperty[];
  rows: PlanRow[];
};

/** Resolve a "Rep" cell (email or full name) to a teammate. */
export function resolveRep(value: string | null, members: Member[]): Member | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return members.find((m) => m.email.toLowerCase() === v) ?? members.find((m) => m.name.toLowerCase() === v) ?? null;
}

function existingLookups(ex: ExistingIndex) {
  const acctByNorm = new Map<string, ExistingIndex["accounts"][number]>();
  for (const a of ex.accounts) if (a.normalized_name && !acctByNorm.has(a.normalized_name)) acctByNorm.set(a.normalized_name, a);
  const conByEmail = new Map<string, ExistingIndex["contacts"][number]>();
  const conByPhone = new Map<string, ExistingIndex["contacts"][number]>();
  const conByAccount = new Map<string, ExistingIndex["contacts"][number][]>();
  for (const c of ex.contacts) {
    if (c.email) conByEmail.set(c.email.toLowerCase(), c);
    for (const part of (c.phone_digits ?? "").split(" ")) {
      const k = phoneKey(part);
      if (k && !conByPhone.has(k)) conByPhone.set(k, c);
    }
    if (c.account_id) conByAccount.set(c.account_id, [...(conByAccount.get(c.account_id) ?? []), c]);
  }
  const propByAddr = new Map<string, ExistingIndex["properties"][number]>();
  const propByAcctName = new Map<string, ExistingIndex["properties"][number]>();
  for (const p of ex.properties) {
    if (p.normalized_address && !propByAddr.has(p.normalized_address)) propByAddr.set(p.normalized_address, p);
    if (p.account_id && p.name) propByAcctName.set(`${p.account_id}|${p.name.toLowerCase().trim()}`, p);
  }
  return { acctByNorm, conByEmail, conByPhone, conByAccount, propByAddr, propByAcctName };
}

/** Find an existing contact for a draft: email, then phone, then name within the same (existing) company. */
export function matchContact(
  d: ContactDraft,
  existingAccountId: string | null,
  lk: Pick<ReturnType<typeof existingLookups>, "conByEmail" | "conByPhone" | "conByAccount">,
): Match | null {
  const label = (c: { full_name: string | null; email: string | null }) => c.full_name ?? c.email ?? "Contact";
  if (d.email) {
    const c = lk.conByEmail.get(d.email.toLowerCase());
    if (c) return { id: c.id, label: label(c), why: "same email" };
  }
  for (const p of [d.phone, d.mobile]) {
    const k = phoneKey(p);
    const c = k ? lk.conByPhone.get(k) : undefined;
    if (c) return { id: c.id, label: label(c), why: "same phone" };
  }
  if (existingAccountId && d.full) {
    let best: { c: ExistingIndex["contacts"][number]; s: number } | null = null;
    for (const c of lk.conByAccount.get(existingAccountId) ?? []) {
      const s = similarity(c.full_name, d.full);
      if (s >= NAME_MATCH && (!best || s > best.s)) best = { c, s };
    }
    if (best) return { id: best.c.id, label: label(best.c), why: best.s >= 0.999 ? "same name, same company" : "similar name, same company" };
  }
  return null;
}

export function planImport(rows: MappedRow[], ex: ExistingIndex, opts: PlanOptions): Plan {
  const lk = existingLookups(ex);
  const accounts = new Map<string, PlanAccount>();
  const contacts = new Map<string, PlanContact>();
  const properties = new Map<string, PlanProperty>();
  // In-sheet contact identity: email / phone / company+name → contact key.
  const conKeyBy = new Map<string, string>();
  const planRows: PlanRow[] = [];

  for (const r of rows) {
    const pr: PlanRow = { index: r.index, accountKey: null, contactKey: null, propertyKey: null, errors: r.errors, warnings: [...r.warnings], skip: r.errors.length > 0 || r.empty, empty: r.empty, dupeOf: null };
    planRows.push(pr);
    if (r.empty) continue;
    let seenBefore = true;

    // Account
    if (r.account) {
      const key = `a:${r.account.norm}`;
      let a = accounts.get(key);
      if (!a) {
        seenBefore = false;
        const m = lk.acctByNorm.get(r.account.norm);
        a = {
          key,
          draft: { ...r.account, account_type: r.account.account_type ?? opts.defaultType },
          match: m ? { id: m.id, label: m.name, why: "same company name" } : null,
          action: m ? "link" : "create",
          ownerId: opts.defaultOwnerId,
          rows: [],
        };
        accounts.set(key, a);
      }
      a.rows.push(r.index);
      // First usable rep in the sheet wins for a new account.
      if (r.repEmail) {
        const rep = resolveRep(r.repEmail, opts.members);
        if (!rep) pr.warnings.push({ field: "rep_email", message: `Rep “${r.repEmail}” isn't on the team — ${opts.defaultOwnerId ? "using the default rep" : "left unassigned"}` });
        else if (!a.rows.slice(0, -1).some((i) => resolveRep(rows[i]?.repEmail ?? null, opts.members))) a.ownerId = rep.user_id;
      }
      pr.accountKey = key;
    }
    const acct = pr.accountKey ? accounts.get(pr.accountKey)! : null;
    const acctExistingId = acct?.match?.id ?? null;

    // Contact
    if (r.contact) {
      const d = r.contact;
      const ids = [
        d.email ? `e:${d.email.toLowerCase()}` : null,
        phoneKey(d.phone) ? `p:${phoneKey(d.phone)}` : null,
        phoneKey(d.mobile) ? `p:${phoneKey(d.mobile)}` : null,
        d.full ? `n:${pr.accountKey ?? "-"}:${personKey(d.full)}` : null,
      ].filter((x): x is string => !!x);
      let key = ids.map((i) => conKeyBy.get(i)).find(Boolean) ?? null;
      if (!key) {
        seenBefore = false;
        key = `c:${contacts.size}`;
        const m = matchContact(d, acctExistingId, lk);
        contacts.set(key, { key, draft: d, accountKey: pr.accountKey, match: m, action: m ? "link" : "create", rows: [] });
      } else {
        // Same person again: fill blanks from the later row.
        const c = contacts.get(key)!;
        c.draft = {
          ...c.draft,
          title: c.draft.title ?? d.title,
          email: c.draft.email ?? d.email,
          phone: c.draft.phone ?? d.phone,
          mobile: c.draft.mobile ?? d.mobile,
          first_name: c.draft.first_name ?? d.first_name,
          last_name: c.draft.last_name ?? d.last_name,
        };
        c.draft.full = [c.draft.first_name, c.draft.last_name].filter(Boolean).join(" ");
        if (!c.accountKey && pr.accountKey) c.accountKey = pr.accountKey;
      }
      for (const i of ids) if (!conKeyBy.has(i)) conKeyBy.set(i, key);
      contacts.get(key)!.rows.push(r.index);
      pr.contactKey = key;
    }

    // Property
    if (r.property) {
      const d = r.property;
      const key = d.norm ? `p:${d.norm}` : `pn:${pr.accountKey ?? "-"}:${(d.name ?? "").toLowerCase().trim()}`;
      let p = properties.get(key);
      if (!p) {
        seenBefore = false;
        const m = d.norm ? lk.propByAddr.get(d.norm) : acctExistingId && d.name ? lk.propByAcctName.get(`${acctExistingId}|${d.name.toLowerCase().trim()}`) : undefined;
        p = {
          key,
          draft: d,
          accountKey: pr.accountKey,
          contactKeys: [],
          match: m ? { id: m.id, label: m.name || m.address1 || "Property", why: d.norm ? "same address" : "same name, same company" } : null,
          action: m ? "link" : "create",
          rows: [],
        };
        properties.set(key, p);
      }
      p.rows.push(r.index);
      if (pr.contactKey && !p.contactKeys.includes(pr.contactKey)) p.contactKeys.push(pr.contactKey);
      pr.propertyKey = key;
    }

    if (seenBefore && (pr.accountKey || pr.contactKey || pr.propertyKey)) {
      const first = [pr.propertyKey && properties.get(pr.propertyKey)?.rows[0], pr.contactKey && contacts.get(pr.contactKey)?.rows[0], pr.accountKey && accounts.get(pr.accountKey)?.rows[0]].find(
        (x) => typeof x === "number" && x !== r.index,
      );
      pr.dupeOf = typeof first === "number" ? first : null;
    }
  }

  return { accounts: [...accounts.values()], contacts: [...contacts.values()], properties: [...properties.values()], rows: planRows };
}

/**
 * Records that will actually be written, after row skips. An entity is live when at least one of its rows is
 * included; everything else is left out of the commit.
 */
export function liveEntities(plan: Plan) {
  const included = new Set(plan.rows.filter((r) => !r.skip).map((r) => r.index));
  const live = <T extends { rows: number[] }>(xs: T[]) => xs.filter((x) => x.rows.some((i) => included.has(i)));
  return { accounts: live(plan.accounts), contacts: live(plan.contacts), properties: live(plan.properties), included };
}

export type PlanCounts = Record<"accounts" | "contacts" | "properties", { create: number; link: number; skip: number; matched: number }> & {
  rows: { total: number; included: number; errors: number; warnings: number; skipped: number; empty: number; repeats: number };
};

export function planCounts(plan: Plan): PlanCounts {
  const { accounts, contacts, properties, included } = liveEntities(plan);
  const tally = (xs: { action: Action; match: Match | null }[]) => ({
    create: xs.filter((x) => x.action === "create").length,
    link: xs.filter((x) => x.action === "link").length,
    skip: xs.filter((x) => x.action === "skip").length,
    matched: xs.filter((x) => x.match).length,
  });
  const real = plan.rows.filter((r) => !r.empty);
  return {
    accounts: tally(accounts),
    contacts: tally(contacts),
    properties: tally(properties),
    rows: {
      total: real.length,
      included: included.size,
      errors: real.filter((r) => r.errors.length > 0).length,
      warnings: real.filter((r) => r.warnings.length > 0).length,
      skipped: real.filter((r) => r.skip).length,
      empty: plan.rows.length - real.length,
      repeats: real.filter((r) => r.dupeOf != null).length,
    },
  };
}

/** Bulk override: set every entity of a kind that is matched (or new) to an action. Link is only valid for matches. */
export function setActions<T extends { match: Match | null; action: Action }>(xs: T[], which: "matched" | "new", action: Action): T[] {
  return xs.map((x) => {
    const isMatch = !!x.match;
    if ((which === "matched") !== isMatch) return x;
    if (action === "link" && !isMatch) return x;
    return { ...x, action };
  });
}

/** Per-rep count of new accounts by owner (for "who gets what" in the preview and result). */
export function ownerTally(plan: Plan): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const a of liveEntities(plan).accounts) if (a.action === "create") out.set(a.ownerId, (out.get(a.ownerId) ?? 0) + 1);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Commit payloads (what the RPCs receive), built from the plan + ids returned by earlier phases.
// ---------------------------------------------------------------------------------------------------------------

export function accountPayload(plan: Plan) {
  return liveEntities(plan)
    .accounts.filter((a) => a.action !== "skip")
    .map((a) => ({
      key: a.key,
      action: a.action,
      id: a.action === "link" ? a.match?.id : undefined,
      name: a.draft.name,
      account_type: a.draft.account_type,
      icp_tier: a.draft.icp_tier,
      owner_user_id: a.ownerId,
      phone: a.draft.phone,
      website: a.draft.website,
      notes: a.draft.notes,
    }));
}

export function contactPayload(plan: Plan, accountIds: Record<string, string>) {
  return liveEntities(plan)
    .contacts.filter((c) => c.action !== "skip")
    .map((c) => ({
      key: c.key,
      action: c.action,
      id: c.action === "link" ? c.match?.id : undefined,
      account_id: c.accountKey ? accountIds[c.accountKey] ?? null : null,
      first_name: c.draft.first_name,
      last_name: c.draft.last_name,
      title: c.draft.title,
      email: c.draft.email,
      phone: c.draft.phone,
      mobile: c.draft.mobile,
      notes: c.draft.notes,
    }));
}

export function propertyPayload(plan: Plan, accountIds: Record<string, string>, contactIds: Record<string, string>, partyRole: "manager" | "owner") {
  return liveEntities(plan)
    .properties.filter((p) => p.action !== "skip")
    .map((p) => ({
      key: p.key,
      action: p.action,
      id: p.action === "link" ? p.match?.id : undefined,
      account_id: p.accountKey ? accountIds[p.accountKey] ?? null : null,
      party_role: partyRole,
      name: p.draft.name,
      address1: p.draft.address1,
      city: p.draft.city,
      state: p.draft.state,
      zip: p.draft.zip,
      asset_class: p.draft.asset_class,
      roof_system: p.draft.roof_system,
      roof_install_year: p.draft.roof_install_year,
      roof_area_sf: p.draft.roof_area_sf,
      unit_count: p.draft.unit_count,
      notes: p.draft.notes,
      contact_ids: p.contactKeys.map((k) => contactIds[k]).filter((x): x is string => !!x),
    }));
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
