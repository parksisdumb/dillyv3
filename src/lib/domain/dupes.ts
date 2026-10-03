// Duplicate-contact suggestions for the Data health card (pure, so it can be tested and reused).

export type DupeContact = { id: string; full_name: string | null; email: string | null; phone: string | null; mobile: string | null; account_id: string | null };

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-10);
const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/** Groups of contacts that look like the same person: same email, same 10-digit phone, or same name on the same account. */
export function duplicateGroups(contacts: DupeContact[]): DupeContact[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const firstBy = new Map<string, string>();
  const link = (key: string, id: string) => {
    const seen = firstBy.get(key);
    if (seen) union(seen, id);
    else firstBy.set(key, id);
  };
  for (const c of contacts) {
    parent.set(c.id, c.id);
    if (c.email) link(`e:${c.email.toLowerCase()}`, c.id);
    for (const p of [digits(c.phone), digits(c.mobile)]) if (p.length === 10) link(`p:${p}`, c.id);
    const n = norm(c.full_name);
    if (n && c.account_id) link(`n:${c.account_id}:${n}`, c.id);
  }
  const groups = new Map<string, DupeContact[]>();
  for (const c of contacts) {
    const r = find(c.id);
    groups.set(r, [...(groups.get(r) ?? []), c]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
