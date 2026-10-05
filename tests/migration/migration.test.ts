/**
 * End-to-end test of the Dilly V2 -> Dilly migration kit for the Supabase SQL editor (migration/sql-editor/*.sql).
 *
 *   - dilly_migration_v2real plays the OLD V2 project: its schema is built from the REAL V2 discovery output
 *     (fixtures/v2-schema-snippet.csv, every column/type/constraint) and filled with three orgs: FOX Roofing plus
 *     Acme Roofing Co and Summit Exteriors, whose rows must never reach Dilly (fixtures/v2-data.sql).
 *   - dilly_migration_e2e is the NEW project, built by scripts/local/reset-db.sh from supabase/migrations.
 *   - Each script is sent exactly the way the SQL editor sends it: the whole file as ONE simple query
 *     (multi-statement, implicit transaction). 01/06 get the local V2 connection instead of the pooler placeholders,
 *     and copy through a real postgres_fdw server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client, type QueryResult } from "pg";
import { loadV2Schema } from "./v2-schema";

const ROOT = path.resolve(__dirname, "../..");
const KIT = path.join(ROOT, "migration", "sql-editor");
const PG = process.env.MIGRATION_TEST_PG ?? "postgresql://postgres@localhost:54329";
const url = (db: string) => `${PG}/${db}?host=/tmp`;
const NEW_DB = "dilly_migration_e2e";
const V2_DB = "dilly_migration_v2real";
const FOX_ORG = "0f0f0000-0000-4000-8000-000000000001";
const ACME_ORG = "0f0f0000-0000-4000-8000-000000000002";

let db: Client; // NEW
let v2: Client; // V2

function mustRun(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stderr}\n${r.stdout}`);
}

/** A script as Parks pastes it; 01/06 with the connection values filled in (local V2 instead of the pooler). */
function script(name: string, opts: { connect?: boolean; foxOverride?: string } = {}): string {
  let sql = fs.readFileSync(path.join(KIT, name), "utf8");
  if (opts.connect) {
    sql = sql
      .replace("'<V2_POOLER_HOST>'", "'/tmp'")
      .replace("v2_port     text := '5432'", "v2_port     text := '54329'")
      .replace("v2_dbname   text := 'postgres'", `v2_dbname   text := '${V2_DB}'`)
      .replace("'<V2_POOLER_USER>'", "'postgres'")
      .replace("'<V2_DB_PASSWORD>'", "'not-used-locally'")
      .replace("v2_sslmode  text := 'require'", "v2_sslmode  text := 'disable'");
  }
  if (opts.foxOverride) {
    sql = sql.replace("('fox_org_id_override', null,", `('fox_org_id_override', '${opts.foxOverride}',`);
  }
  return sql;
}

/** Runs a whole file as one simple query (like the SQL editor) and returns the LAST result set (what the editor shows). */
async function runScript(c: Client, sql: string): Promise<Record<string, unknown>[]> {
  const res = (await c.query(sql)) as unknown as QueryResult | QueryResult[];
  const list = Array.isArray(res) ? res : [res];
  return list[list.length - 1].rows;
}
async function runFails(c: Client, sql: string): Promise<string> {
  try {
    await c.query(sql);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the script to fail");
}
async function q<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows as T[];
}
async function val<T = unknown>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q<Record<string, T>>(c, sql, params);
  return Object.values(rows[0])[0];
}
const migrate = async () => {
  await runScript(db, script("02-preflight.sql"));
  return runScript(db, script("03-transform.sql"));
};
const reconcile = () => runScript(db, script("04-reconcile.sql"));

/** Stable fingerprint of everything the migration wrote (updated_at excluded: triggers bump it on upsert). */
const FINGERPRINT = `
  select md5(string_agg(x, '|' order by x)) from (
    select 'a' || legacy_id || name || account_type || icp_tier || onboarding_status || is_test || coalesce(owner_user_id::text,'') || coalesce(last_touch_at::text,'') x from public.account where source = 'dillyv2'
    union all select 'c' || legacy_id || coalesce(full_name,'') || coalesce(account_id::text,'') || persona_role || is_test || coalesce(last_touch_at::text,'') from public.contact where source = 'dillyv2'
    union all select 'p' || legacy_id || coalesce(name,'') || coalesce(account_id::text,'') || is_test || coalesce(roof_install_year::text,'') from public.property where source = 'dillyv2'
    union all select 'pp' || property_id || account_id || role || coalesce(started_on::text,'') || coalesce(ended_on::text,'') || source from public.property_party
    union all select 'pc' || property_id || contact_id || coalesce(role,'') from public.property_contact
    union all select 'ce' || contact_id || account_id || source || coalesce(ended_on::text,'') from public.contact_employment
    union all select 'pu' || property_id || user_id || status from public.property_pursuit
    union all select 'o' || legacy_id || name || stage || service_line || value_estimate || coalesce(lost_reason,'') from public.opportunity where source = 'dillyv2'
    union all select 't' || legacy_id || channel || outcome || direction || occurred_at || coalesce(user_id::text,'') || coalesce(external_id,'') || is_first_touch from public.touch where source = 'dillyv2'
    union all select 'k' || legacy_id || status || due_on || created_at || coalesce(completed_by_touch_id::text,'') || coalesce(assignee_user_id::text,'') from public.task where source = 'dillyv2'
    union all select 'ap' || account_id || preference from public.account_preference
    union all select 'i' || email || role from public.invite
    union all select 'm' || user_id || role from public.membership
  ) s`;

beforeAll(async () => {
  mustRun("./scripts/local/reset-db.sh", [], { DB: NEW_DB });
  mustRun("psql", [url("postgres"), "-X", "-q", "-c", `drop database if exists ${V2_DB}`, "-c", `create database ${V2_DB}`]);
  v2 = new Client({ connectionString: url(V2_DB) });
  await v2.connect();
  await v2.query("create schema auth; create table auth.users (id uuid primary key, email text);");
  await v2.query(loadV2Schema().ddl);
  await v2.query(fs.readFileSync(path.join(__dirname, "fixtures", "v2-data.sql"), "utf8"));
  db = new Client({ connectionString: url(NEW_DB) });
  await db.connect();
  // Five FOX people have signed in to Dilly already (Dylan has not). Colby's V2 email is mixed case.
  for (const email of ["parks@foxroofing.co", "tyler@foxroofing.co", "ben@foxroofing.co", "colby@foxroofing.co", "kayla@foxroofing.co"]) {
    await db.query("insert into auth.users(email) values ($1)", [email]);
  }
}, 180_000);

afterAll(async () => {
  await db?.end();
  await v2?.end();
});

describe("Dilly V2 -> Dilly migration (Supabase SQL editor kit)", () => {
  it("the synthetic V2 database has exactly the real V2 shape from the discovery CSV", async () => {
    const schema = loadV2Schema();
    expect(schema.tables.size).toBe(51);
    const cols = await q<{ table_name: string; n: number }>(v2,
      "select table_name, count(*)::int n from information_schema.columns where table_schema = 'public' group by 1");
    for (const r of cols) expect(r.n, r.table_name).toBe(schema.tables.get(r.table_name)?.columns.length);
    expect(cols.length).toBe(51);
  });

  it("01 stops until the V2 connection values are filled in", async () => {
    expect(await runFails(db, script("01-connect-v2.sql"))).toMatch(/Fill in v2_host, v2_user and v2_password/);
    expect(await val(db, "select count(*)::int from pg_foreign_server")).toBe(0);
  });

  it("01 copies every V2 table (all orgs) into legacy through a read-only FDW, with snapshot counts", async () => {
    const before = await val<string>(v2, "select md5(string_agg(t || ':' || n, ',' order by t)) from (select relname t, n_tup_ins + n_tup_upd + n_tup_del n from pg_stat_user_tables) s");
    const rows = await runScript(db, script("01-connect-v2.sql", { connect: true }));
    expect(rows).toHaveLength(51);
    for (const r of rows) expect(r.copied_rows, String(r.table_name)).toBe(r.v2_rows);
    expect(await val(db, "select count(*)::int from legacy.touchpoints")).toBe(await val(v2, "select count(*)::int from public.touchpoints"));
    expect(await val(db, "select count(*)::int from legacy.orgs")).toBe(3);
    expect(await val(db, "select string_agg(a.attname, ',' order by k.ord) from pg_index i cross join unnest(i.indkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum where i.indrelid = 'legacy.property_contacts'::regclass and i.indisprimary"))
      .toBe("property_id,contact_id,role_category");
    expect(await val(db, "select count(*)::int from migration.snapshot where kind = 'full' and finished_at is not null")).toBe(1);
    // read-only by construction: the server refuses writes, and V2 saw no writes
    expect(await val(db, "select array_to_string(srvoptions, ',') from pg_foreign_server where srvname = 'dilly_v2'")).toMatch(/updatable=false/);
    await expect(db.query("insert into legacy_fdw.orgs(id, name) values (gen_random_uuid(), 'x')")).rejects.toThrow(/does not allow inserts/);
    const after = await val<string>(v2, "select md5(string_agg(t || ':' || n, ',' order by t)) from (select relname t, n_tup_ins + n_tup_upd + n_tup_del n from pg_stat_user_tables) s");
    expect(after).toBe(before);
  }, 60_000);

  it("02 refuses an ambiguous FOX org (printing the org list) and accepts an explicit id", async () => {
    await db.query("update legacy.orgs set name = 'Foxtrot Demo' where id = $1", [ACME_ORG]);
    try {
      const msg = await runFails(db, script("02-preflight.sql"));
      expect(msg).toMatch(/2 V2 orgs match/);
      expect(msg).toContain(`${FOX_ORG}  FOX Roofing`);
      expect(msg).toContain("Foxtrot Demo");
      const rows = await runScript(db, script("02-preflight.sql", { foxOverride: FOX_ORG }));
      expect(rows[0]).toEqual({ check: "preflight", value: "PASS — run 03-transform.sql next" });
    } finally {
      await db.query("update legacy.orgs set name = 'Acme Roofing Co' where id = $1", [ACME_ORG]);
    }
  });

  it("an unmapped value stops 02 and 03 with the full list; nothing is written; other orgs' odd values never block", async () => {
    await db.query(`insert into legacy.touchpoint_outcomes(id, org_id, key, name, sort_order, qualifies_opportunity, created_at)
                    values ('11111111-1111-4111-8111-111111111111', null, 'smoke_2', 'Left a smoke signal', 99, false, now())`);
    await db.query("update legacy.touchpoints set outcome_id = '11111111-1111-4111-8111-111111111111' where id = md5('tp2')::uuid");
    try {
      const msg = await runFails(db, script("02-preflight.sql"));
      expect(msg).toContain("unmapped touch_outcome value 'Left a smoke signal' [key 'smoke_2'] (touchpoints -> touchpoint_outcomes, 1 rows)");
      expect(msg).not.toMatch(/Smoke Signal|Weird Type|mystery|Supreme Leader|Estimating|whenever/); // Acme/Summit values
      expect(await runFails(db, script("03-transform.sql"))).toMatch(/migration preflight failed/);
      expect(await val(db, "select count(*)::int from public.touch")).toBe(0);
      expect(await val(db, "select count(*)::int from public.account where source = 'dillyv2'")).toBe(0);
    } finally {
      // back to the fixture's original outcome for tp2 (text touch, 'No Answer — no voicemail')
      await db.query("update legacy.touchpoints set outcome_id = md5('to-no_answer')::uuid where id = md5('tp2')::uuid");
      await db.query("delete from legacy.touchpoint_outcomes where id = '11111111-1111-4111-8111-111111111111'");
    }
  });

  it("02 -> 03 twice is idempotent and loads exactly the FOX rows", async () => {
    const summary = await migrate();
    expect(summary.find((r) => r.entity === "touches")?.rows).toBe("312");
    const first = await val<string>(db, FINGERPRINT);
    await migrate();
    expect(await val<string>(db, FINGERPRINT)).toBe(first);

    const counts = await q(db, `
      select (select count(*)::int from public.account where source = 'dillyv2') accounts,
             (select count(*)::int from public.contact where source = 'dillyv2') contacts,
             (select count(*)::int from public.property where source = 'dillyv2') properties,
             (select count(*)::int from public.property_contact) links,
             (select count(*)::int from public.opportunity where source = 'dillyv2') opps,
             (select sum(value_estimate)::int from public.opportunity where source = 'dillyv2') opp_value,
             (select count(*)::int from public.touch where source = 'dillyv2') touches,
             (select count(*)::int from public.task where source = 'dillyv2') tasks,
             (select count(*)::int from public.property_pursuit) pursuits`);
    // 130 property_contacts rows - 5 inactive - 5 second roles on the same pair = 120 links;
    // 300 touchpoints + 12 matched-but-unlogged Gmail messages; 15 assignments - 5 of Dylan (not signed in) = 10 pursuits
    expect(counts[0]).toEqual({ accounts: 40, contacts: 120, properties: 100, links: 120, opps: 18, opp_value: 377000, touches: 312, tasks: 170, pursuits: 10 });
  }, 120_000);

  it("04 reconcile: verdict PASS, zero FAIL rows", async () => {
    const rows = await reconcile();
    expect(rows[0]).toMatchObject({ check_name: "VERDICT", status: "PASS" });
    expect(rows.filter((r) => r.status === "FAIL")).toEqual([]);
    const names = new Set(rows.map((r) => r.check_name));
    for (const n of ["other_v2_orgs_not_migrated", "row_count", "every_legacy_id_present", "property_current_party", "opportunity_value_total",
                     "touches_per_rep_per_week", "contacts_per_account", "properties_per_account", "notes_length", "touch_fields_match",
                     "task_dates_match", "timestamp_sample", "open_tasks_with_later_touch", "migration_created_no_tasks_or_points", "legacy_points_kept"]) {
      expect(names, n).toContain(n);
    }
  }, 60_000);

  it("other V2 orgs never reach Dilly (they stay in legacy only)", async () => {
    expect(await val(db, "select count(*)::int from public.account where name like 'Acme%' or name like 'Summit%'")).toBe(0);
    expect(await val(db, "select count(*)::int from public.touch where notes = 'Other org touch'")).toBe(0);
    expect(await val(db, "select count(*)::int from public.invite where email::text like '%acmeroofing.com' or email::text like '%summitexteriors.com'")).toBe(0);
    expect(await val(db, "select count(*)::int from public.opportunity where value_estimate = 99999")).toBe(0);
    expect(await val(db, "select count(*)::int from legacy.accounts where org_id <> $1", [FOX_ORG])).toBe(12);
    // Parks is in FOX (admin) and Acme in V2: one Dilly membership in FOX, nothing else
    expect(await val(db, "select string_agg(t.slug || ':' || m.role, ',') from public.membership m join public.tenant t on t.id = m.tenant_id join public.profile p on p.id = m.user_id where p.email = 'parks@foxroofing.co'"))
      .toBe("fox:admin");
  });

  it("follow-ups: closed by a later touch, never by the touch that created them; no new tasks, no points", async () => {
    // V2 creates a follow-up in the same transaction as its touch (identical timestamps). Those whose contact has
    // no LATER touch must stay open.
    const expectedOpen = await val<number>(db, `
      select count(*)::int from legacy.next_actions n
       where n.org_id = $1 and n.status = 'open'
         and not exists (select 1 from legacy.touchpoints t where t.contact_id = n.contact_id and t.org_id = n.org_id
                           and (t.happened_at > n.created_at or (t.happened_at = n.created_at and t.id is distinct from n.created_from_touchpoint_id)))
         and not exists (select 1 from legacy.synced_emails s where s.matched_contact_id = n.contact_id and s.touchpoint_id is null
                           and s.org_id = n.org_id and s.message_ts >= n.created_at)`, [FOX_ORG]);
    expect(expectedOpen).toBeGreaterThanOrEqual(50);
    expect(await val(db, "select count(*)::int from public.task where source = 'dillyv2' and status = 'open'")).toBe(expectedOpen);
    const selfCreatedOpen = await val<number>(db, `
      select count(*)::int from public.task k join public.touch x on x.id = k.created_from_touch_id
       where k.source = 'dillyv2' and k.status = 'open' and k.created_at = x.occurred_at + interval '1 millisecond'`);
    expect(selfCreatedOpen).toBeGreaterThanOrEqual(50);
    expect(await val(db, "select count(*)::int from public.task where source = 'dillyv2' and status = 'done' and legacy_id in (select id::text from legacy.next_actions where status = 'completed')")).toBe(15);
    expect(await val(db, "select count(*)::int from public.task where source = 'dillyv2' and status = 'dropped'")).toBe(5);
    expect(await val(db, "select count(*)::int from public.task where source <> 'dillyv2'")).toBe(0);
    expect(await val(db, "select count(*)::int from public.point_event")).toBe(0);
    expect(await val(db, "select count(*)::int from public.account where source = 'dillyv2' and last_touch_at is not null")).toBeGreaterThan(30);
    // due date = V2 due_at's calendar day in the tenant's time zone
    expect(await val(db, `select count(*)::int from public.task k join legacy.next_actions n on n.id::text = k.legacy_id
                           where k.due_on <> (n.due_at at time zone 'America/Chicago')::date`)).toBe(0);
  });

  it("Gmail: linked messages keep their id (no double count), unlogged matched ones become touches, the rest stay legacy", async () => {
    const linkedIds = await val<number>(db, "select count(distinct gmail_message_id)::int from legacy.synced_emails where org_id = $1 and touchpoint_id is not null", [FOX_ORG]);
    expect(await val(db, "select count(*)::int from public.touch where legacy_table = 'touchpoints' and external_id like 'gmail:%'")).toBe(linkedIds);
    expect(await val(db, "select count(*)::int from public.touch where legacy_table = 'synced_emails' and external_id like 'gmail:gm-u%'")).toBe(12);
    expect(await val(db, "select count(*)::int from public.touch where external_id like 'gmail:gm-r%' or external_id like 'gmail:gm-n%' or external_id like 'gmail:acme-%'")).toBe(0);
    expect(await val(db, "select count(*)::int from migration.flagged_row where flag = 'duplicate_gmail_message'")).toBe(1);
    expect(await val(db, "select channel || '/' || outcome || '/' || direction from public.touch where external_id = 'gmail:gm-u3'")).toBe("email/replied/inbound");
    expect(await val(db, "select channel || '/' || outcome from public.touch where external_id = 'gmail:gm-u1'")).toBe("email/sent");
    // value maps worked through names (typographic apostrophe, keys that differ from labels)
    expect(await val(db, "select count(*)::int from public.touch t join legacy.touchpoints l on l.id::text = t.legacy_id where l.outcome_id = md5('to-gatekeeper')::uuid and t.outcome <> 'gatekeeper'")).toBe(0);
    expect(await val(db, "select count(*)::int from public.touch where outcome = 'auto_reply' and direction = 'inbound'")).toBeGreaterThan(0);
  });

  it("ownership & management: V2 links become property_party history with source dillyv2; property.account_id follows", async () => {
    const acct = (n: number) => `(select id from public.account where legacy_id = md5('acct${n}')::uuid::text)`;
    const prop = (n: number) => `(select id from public.property where legacy_id = md5('prop${n}')::uuid::text)`;
    // prop1: owner acct22 (property_accounts) + manager acct1 (primary_account_id) -> account = the manager
    expect(await val(db, `select string_agg(role || '=' || (account_id = case role when 'owner' then ${acct(22)} else ${acct(1)} end), ',' order by role)
                           from public.property_party where property_id = ${prop(1)} and ended_on is null`)).toBe("manager=true,owner=true");
    expect(await val(db, `select account_id = ${acct(1)} from public.property where id = ${prop(1)}`)).toBe(true);
    // prop14: ended V2 manager (acct24, 2023-01-01..2025-05-31) kept as history + current manager acct14
    expect(await val(db, `select started_on || '..' || ended_on from public.property_party where property_id = ${prop(14)} and account_id = ${acct(24)}`)).toBe("2023-01-01..2025-05-31");
    expect(await val(db, `select account_id = ${acct(14)} from public.property where id = ${prop(14)}`)).toBe(true);
    // prop17: two current V2 managers -> the primary one wins, the other is flagged; primary_account_id becomes owner
    expect(await val(db, `select account_id = ${acct(30)} from public.property where id = ${prop(17)}`)).toBe(true);
    expect(await val(db, `select account_id = ${acct(17)} from public.property_party where property_id = ${prop(17)} and role = 'owner' and ended_on is null`)).toBe(true);
    expect(await val(db, "select count(*)::int from migration.flagged_row where flag = 'extra_current'")).toBe(1);
    // GC link is not an ownership party: kept as a legacy value
    expect(await val(db, `select count(*)::int from migration.legacy_value where field = 'related_account' and value like 'gc:%'`)).toBe(2);
    // no primary account in V2 -> unlinked building; every party row came from dillyv2
    expect(await val(db, `select account_id from public.property where id = ${prop(95)}`)).toBe(null);
    expect(await val(db, "select string_agg(distinct source, ',') from public.property_party")).toBe("dillyv2");
    expect(await val(db, "select string_agg(distinct source, ',') from public.contact_employment")).toBe("dillyv2");
  });

  it("people: matched by email (any case); not signed in -> invite + unmapped actor; no email -> kept, warned", async () => {
    expect(await val(db, "select profile_id is not null from migration.user_map where email = 'colby@foxroofing.co'")).toBe(true);
    expect(await val(db, "select count(*)::int from public.membership m join public.tenant t on t.id = m.tenant_id where t.slug = 'fox'")).toBe(5);
    expect(await val(db, "select count(*)::int from public.invite i join public.tenant t on t.id = i.tenant_id where t.slug = 'fox' and i.email = 'dylan@foxroofing.co'")).toBe(1);
    const dylan = await val<number>(db, "select count(*)::int from legacy.touchpoints where rep_user_id = '00000000-0000-4000-8000-0000000000a5'");
    expect(dylan).toBe(60);
    expect(await val(db, "select count(*)::int from public.touch where source = 'dillyv2' and user_id is null")).toBe(dylan);
    expect(await val(db, "select count(*)::int from migration.unmapped_actor where role_column = 'actor' and legacy_email = 'dylan@foxroofing.co'")).toBe(dylan);
    expect(await val(db, "select count(*)::int from migration.user_map where legacy_user_id = '00000000-0000-4000-8000-0000000000a7' and profile_id is null and invite_id is null")).toBe(1);
    // owners: account_assignments first, then property_assignments, then the creating rep
    expect(await val(db, "select p.email::text from public.account a join public.profile p on p.id = a.owner_user_id where a.legacy_id = md5('acct1')::uuid::text")).toBe("ben@foxroofing.co");
    expect(await val(db, "select count(*)::int from public.account_assignment")).toBe(1);
    expect(await val(db, "select count(*)::int from migration.legacy_value where field = 'legacy_points' and legacy_table = 'org_users'")).toBe(5);
  });

  it("flags test rows, soft-deleted V2 rows and duplicates without dropping or merging anything", async () => {
    expect(await val(db, "select is_test from public.account where name = 'CBRE — Austin (address TBD)'")).toBe(true);
    expect(await val(db, "select is_test from public.contact where legacy_id = md5('contact9')::uuid::text")).toBe(true);
    expect(await val(db, "select is_test from public.property where address1 = '123 Test 2'")).toBe(true);
    expect(await val(db, "select count(*)::int from migration.flagged_row where flag = 'soft_deleted_in_v2'")).toBe(6);
    expect(await val(db, "select count(*)::int from migration.duplicate_suggestion")).toBe(3);
    expect(await val(db, "select count(*)::int from public.contact where duplicate_of is not null")).toBe(0);
    // contact7's V2 account was soft-deleted: migrated without an account and flagged
    expect(await val(db, "select account_id from public.contact where legacy_id = md5('contact7')::uuid::text")).toBe(null);
    // opp3 was lost while sitting in Proposal Sent: stage lost, reason kept
    expect(await val(db, "select stage || ' / ' || lost_reason from public.opportunity where legacy_id = md5('opp3')::uuid::text")).toBe("lost / Price: Owner chose the low bid");
    expect(await val(db, "select value from migration.legacy_value where field = 'v2_stage' and legacy_id = md5('opp3')::uuid::text")).toBe("Proposal Sent");
  });

  it("reconcile FAILs (and the verdict says do not cut over) when a note is truncated or a row goes missing", async () => {
    await db.query("begin");
    try {
      await db.query("update public.account set notes = left(notes, 10) where legacy_id = md5('acct4')::uuid::text");
      // (an opportunity no touch points at: the touch ledger itself is append-only)
      await db.query("delete from public.opportunity where legacy_id = md5('opp2')::uuid::text");
      const rows = await q<{ check_name: string; entity: string; status: string }>(db, "select check_name, entity, status from migration.reconcile() where status = 'FAIL'");
      const names = rows.map((f) => `${f.check_name}:${f.entity}`);
      expect(names).toContain("notes_length:accounts.notes");
      expect(names).toContain("row_count:opportunities -> opportunity");
      expect(names).toContain("every_legacy_id_present:opportunities -> opportunity");
      expect(names).toContain("opportunity_value_total:opportunities");
    } finally {
      await db.query("rollback");
    }
  });

  it("01 refuses to copy again once data was transformed; 05 removes the V2 connection and credentials", async () => {
    expect(await runFails(db, script("01-connect-v2.sql", { connect: true }))).toMatch(/already copied .* For V2 changes since then run 06-delta.sql/);
    const rows = await runScript(db, script("05-drop-fdw.sql"));
    expect(rows[0]).toEqual({ check: "V2 connection removed", value: "PASS: no V2 server or credentials stored" });
    expect(await val(db, "select count(*)::int from pg_user_mappings")).toBe(0);
    expect(await val(db, "select count(*)::int from pg_namespace where nspname = 'legacy_fdw'")).toBe(0);
    expect(await val(db, "select count(*)::int from legacy.touchpoints")).toBe(330);
    await runScript(db, script("05-drop-fdw.sql")); // re-runnable
  });

  it("re-running 03 after a rep signs in re-attributes their touches (no points)", async () => {
    await db.query("insert into auth.users(email) values ('dylan@foxroofing.co')");
    await migrate();
    expect(await val(db, "select count(*)::int from public.touch where source = 'dillyv2' and user_id is null")).toBe(0);
    expect(await val(db, "select count(*)::int from public.property_pursuit")).toBe(15);
    expect(await val(db, "select count(*)::int from public.point_event")).toBe(0);
    const rows = await reconcile();
    expect(rows[0]).toMatchObject({ status: "PASS" });
    expect(rows.find((r) => r.check_name === "unmapped_actors")).toMatchObject({ status: "PASS" });
  }, 120_000);

  it("06-delta (cutover) brings V2 changes since the snapshot, archives replaced versions, keeps deletions, and drops the connection", async () => {
    const acct = (n: number) => `(select id from public.account where legacy_id = md5('acct${n}')::uuid::text)`;
    const prop = (n: number) => `(select id from public.property where legacy_id = md5('prop${n}')::uuid::text)`;
    // In Dilly, a rep transfers prop2's management to acct3 (Dilly now owns prop2's history).
    await db.query(`update public.property_party set ended_on = current_date where property_id = ${prop(2)} and role = 'manager' and ended_on is null`);
    await db.query(`insert into public.property_party(tenant_id, property_id, account_id, role, started_on, source)
                    select tenant_id, id, ${acct(3)}, 'manager', current_date, 'transfer' from public.property where id = ${prop(2)}`);
    // Meanwhile in V2: a new touch, an edited contact, a new column, a deleted link, and manager changes on prop2 and prop6.
    await v2.query(`insert into public.touchpoints(org_id, rep_user_id, account_id, contact_id, touchpoint_type_id, outcome_id, happened_at, engagement_phase, direction, notes)
                    values ($1, '00000000-0000-4000-8000-0000000000a3', md5('acct5')::uuid, md5('contact5')::uuid, md5('tt-site_visit')::uuid, md5('to-met')::uuid, now(), 'follow_up', 'outbound', 'Logged after the snapshot')`, [FOX_ORG]);
    await v2.query("update public.contacts set title = 'Regional Manager' where id = md5('contact8')::uuid");
    await v2.query("alter table public.contacts add column nickname text");
    await v2.query("update public.contacts set nickname = 'JL' where id = md5('contact10')::uuid");
    await v2.query("delete from public.property_contacts where property_id = md5('prop1')::uuid and role_category = 'leasing'");
    await v2.query("update public.properties set primary_account_id = md5('acct5')::uuid where id = md5('prop2')::uuid");
    await v2.query("update public.properties set primary_account_id = md5('acct9')::uuid where id = md5('prop6')::uuid");

    expect(await runFails(db, script("06-delta.sql"))).toMatch(/Fill in v2_host/);
    const rows = await runScript(db, script("06-delta.sql", { connect: true }));
    const total = rows.find((r) => r.table_name === "(total)");
    expect(total).toMatchObject({ changed: "4", new_rows: "1", gone_from_v2_kept: "1" }); // contacts 2 + properties 2
    expect(rows.find((r) => r.table_name === "contacts")).toMatchObject({ changed: "2" }); // contact8 + contact10
    expect(await val(db, "select count(*)::int from legacy._superseded where table_name = 'contacts'")).toBe(2);
    expect(await val(db, "select count(*)::int from legacy._delta_missing where table_name = 'property_contacts'")).toBe(1);
    expect(await val(db, "select count(*)::int from legacy.property_contacts")).toBe(130); // never removed
    expect(await val(db, "select nickname from legacy.contacts where id = md5('contact10')::uuid")).toBe("JL");
    expect(await val(db, "select count(*)::int from pg_foreign_server")).toBe(0);
    expect(await val(db, "select count(*)::int from migration.snapshot where kind = 'delta'")).toBe(1);

    await migrate();
    const rec = await reconcile();
    expect(rec.filter((r) => r.status === "FAIL")).toEqual([]);
    expect(rec[0]).toMatchObject({ status: "PASS" });
    expect(await val(db, "select count(*)::int from public.touch where source = 'dillyv2'")).toBe(313);
    expect(await val(db, "select title from public.contact where legacy_id = md5('contact8')::uuid::text")).toBe("Regional Manager");
    // Dilly's transfer wins over V2's later edit; a building with no Dilly history follows V2, keeping its history.
    expect(await val(db, `select account_id = ${acct(3)} from public.property where id = ${prop(2)}`)).toBe(true);
    expect(await val(db, `select account_id = ${acct(9)} from public.property where id = ${prop(6)}`)).toBe(true);
    expect(await val(db, `select count(*)::int from public.property_party where property_id = ${prop(6)} and role = 'manager' and ended_on is not null and account_id = ${acct(6)}`)).toBe(1);
  }, 120_000);

  it("V2-freeze makes V2 read-only for the app (grants saved) and V2-unfreeze restores them; both refuse the NEW project", async () => {
    expect(await runFails(db, script("V2-freeze.sql"))).toMatch(/This is the NEW Dilly project/);
    const tryWrite = async () => {
      await v2.query("begin");
      try {
        await v2.query("set local role authenticated");
        await v2.query("insert into public.territories(org_id, name) values ($1, 'freeze probe')", [FOX_ORG]);
        return "ok";
      } catch (e) {
        return (e as Error).message;
      } finally {
        await v2.query("rollback");
      }
    };
    expect(await tryWrite()).toBe("ok");
    const frozen = await runScript(v2, script("V2-freeze.sql"));
    expect(frozen[0]).toMatchObject({ tables_still_writable_by_reps: "0" });
    await runScript(v2, script("V2-freeze.sql")); // re-run keeps the ORIGINAL saved grants
    expect(await tryWrite()).toMatch(/permission denied/);
    expect(await val(v2, "select count(*)::int from public.touchpoints")).toBeGreaterThan(0); // reads still work
    await runScript(v2, script("V2-unfreeze.sql"));
    expect(await tryWrite()).toBe("ok");
  });
});
