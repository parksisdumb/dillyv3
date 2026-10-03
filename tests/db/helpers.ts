import { Client } from "pg";

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:54329/dilly_test?host=/tmp";

export async function connect() {
  const c = new Client({ connectionString: TEST_DB_URL });
  await c.connect();
  return c;
}

/** Run fn inside a transaction that is always rolled back, so tests never leak state. */
export async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await connect();
  try {
    await c.query("begin");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

export async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  const r = await c.query(sql, params);
  return r.rows[0] as T;
}

export async function tenantId(c: Client, slug: string): Promise<string> {
  return (await one<{ id: string }>(c, "select id from public.tenant where slug = $1", [slug])).id;
}

/** Create an auth user + profile + membership; returns the user id. */
export async function makeUser(c: Client, tenant: string, email: string, role = "rep"): Promise<string> {
  const u = await one<{ id: string }>(c, "insert into auth.users(email) values ($1) returning id", [email]);
  await c.query("insert into public.membership(tenant_id, user_id, role) values ($1,$2,$3)", [tenant, u.id, role]);
  return u.id;
}

/** Switch the session to an authenticated Supabase user (RLS applies). */
export async function actAs(c: Client, userId: string) {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await c.query("set local role authenticated");
}

export async function actAsService(c: Client) {
  await c.query("reset role");
}
