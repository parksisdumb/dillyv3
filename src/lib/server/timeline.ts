import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import type { TimelineTouch } from "@/components/accounts/touch-timeline";

type TouchRow = {
  id: string;
  occurred_at: string;
  channel: string;
  outcome: string;
  notes: string | null;
  user_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  voided_at: string | null;
};

/** Attach rep, contact and account names to touch rows. */
export async function withNames(c: Pick<Ctx, "sb">, rows: TouchRow[]): Promise<TimelineTouch[]> {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const users = uniq(rows.map((r) => r.user_id));
  const contacts = uniq(rows.map((r) => r.contact_id));
  const accounts = uniq(rows.map((r) => r.account_id));
  const [u, ct, ac] = await Promise.all([
    users.length ? c.sb.from("profile").select("id,full_name,email").in("id", users) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    contacts.length ? c.sb.from("contact").select("id,full_name").in("id", contacts) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    accounts.length ? c.sb.from("account").select("id,name").in("id", accounts) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const um = new Map((u.data ?? []).map((x) => [x.id, x.full_name || x.email]));
  const cm = new Map((ct.data ?? []).map((x) => [x.id, x.full_name]));
  const am = new Map((ac.data ?? []).map((x) => [x.id, x.name]));
  return rows.map((r) => ({
    id: r.id,
    occurred_at: r.occurred_at,
    channel: r.channel,
    outcome: r.outcome,
    notes: r.notes,
    who: r.user_id ? um.get(r.user_id) ?? null : null,
    contact: r.contact_id ? cm.get(r.contact_id) ?? null : null,
    contact_id: r.contact_id,
    account: r.account_id ? am.get(r.account_id) ?? null : null,
    account_id: r.account_id,
    voided: !!r.voided_at,
  }));
}

export const TOUCH_COLS = "id,occurred_at,channel,outcome,notes,user_id,contact_id,account_id,voided_at";
