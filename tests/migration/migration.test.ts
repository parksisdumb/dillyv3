/**
 * End-to-end test of the Dilly V2 -> Dilly migration kit (migration/**), run against local Postgres:
 *   - a synthetic "V2" database (tests/migration/fixtures/v2-source.sql) plays the old Supabase project
 *   - dilly_migration_test gets the NEW schema via scripts/local/reset-db.sh
 * The real scripts run exactly as in the runbook: dump -> discover -> restore legacy -> transform (twice) -> reconcile,
 * then failure modes (unknown enum value, truncated notes), reattribution, delta and freeze.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";

const ROOT = path.resolve(__dirname, "../..");
const PG = process.env.MIGRATION_TEST_PG ?? "postgresql://postgres@localhost:54329";
const url = (db: string) => `${PG}/${db}?host=/tmp`;
const NEW_DB = "dilly_migration_test";
const V2_DB = "dilly_migration_v2src";
const NEW_URL = url(NEW_DB);
const V2_URL = url(V2_DB);
const ADMIN_URL = url("postgres");
const FOX_ORG = "0f0f0000-0000-4000-8000-000000000001";
const OUT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dilly-migration-out-"));

const ENV = {
  ...process.env,
  V2_DB_URL: V2_URL,
  NEW_DB_URL: NEW_URL,
  SCRATCH_DB_URL: ADMIN_URL,
  OUT_ROOT,
  LEGACY_ORG_ID: FOX_ORG,
  TENANT_SLUG: "fox",
};

function run(cmd: string, args: string[] = [], env: Record<string, string | undefined> = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...ENV, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function mustRun(cmd: string, args: string[] = [], env: Record<string, string | undefined> = {}) {
  const r = run(cmd, args, env);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stderr}\n${r.stdout}`);
  return r;
}

let db: Client; // NEW
let v2: Client; // synthetic V2
async function q<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows as T[];
}
async function val<T = unknown>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q<Record<string, T>>(c, sql, params);
  return Object.values(rows[0])[0];
}

/** Stable fingerprint of everything the migration wrote (updated_at excluded: triggers bump it on upsert). */
const FINGERPRINT = `
  select md5(string_agg(x, '|' order by x)) from (
    select 'a' || legacy_id || name || account_type || icp_tier || onboarding_status || is_test || coalesce(owner_user_id::text,'') || coalesce(last_touch_at::text,'') x from public.account where source = 'dillyv2'
    union all select 'c' || legacy_id || coalesce(full_name,'') || coalesce(account_id::text,'') || is_test || coalesce(notes,'') || coalesce(last_touch_at::text,'') from public.contact where source = 'dillyv2'
    union all select 'p' || legacy_id || coalesce(name,'') || coalesce(account_id::text,'') || is_test from public.property where source = 'dillyv2'
    union all select 'pc' || property_id || contact_id || coalesce(role,'') from public.property_contact
    union all select 'o' || legacy_id || name || stage || service_line || value_estimate from public.opportunity where source = 'dillyv2'
    union all select 't' || legacy_id || channel || outcome || direction || occurred_at || coalesce(user_id::text,'') || coalesce(external_id,'') || is_first_touch from public.touch where source = 'dillyv2'
    union all select 'k' || legacy_id || status || due_on || created_at || coalesce(completed_by_touch_id::text,'') || coalesce(assignee_user_id::text,'') from public.task where source = 'dillyv2'
    union all select 'ap' || account_id || preference from public.account_preference
    union all select 'i' || email || role from public.invite
    union all select 'm' || user_id || role from public.membership
  ) s`;

beforeAll(async () => {
  mustRun("./scripts/local/reset-db.sh", [], { DB: NEW_DB });
  mustRun("psql", [ADMIN_URL, "-X", "-q", "-c", `drop database if exists ${V2_DB}`, "-c", `create database ${V2_DB}`]);
  mustRun("psql", [V2_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "tests/migration/fixtures/v2-source.sql"]);
  db = new Client({ connectionString: NEW_URL });
  v2 = new Client({ connectionString: V2_URL });
  await db.connect();
  await v2.connect();
  // Five of the six FOX users have already signed in to the new app (Dylan has not). Colby's V2 email is mixed-case.
  for (const email of ["parks@foxroofing.co", "tyler@foxroofing.co", "ben@foxroofing.co", "colby@foxroofing.co", "kayla@foxroofing.co"]) {
    await db.query("insert into auth.users(email) values ($1)", [email]);
  }
}, 120_000);

afterAll(async () => {
  await db?.end();
  await v2?.end();
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
});

describe("Dilly V2 -> Dilly migration kit", () => {
  it("01-dump refuses to run when V2_DB_URL is actually the NEW database", () => {
    const r = run("migration/01-dump.sh", [], { V2_DB_URL: NEW_URL });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to run/);
  });

  it("01-dump takes a read-only copy with checksums, snapshot time and exact row counts", () => {
    mustRun("migration/01-dump.sh");
    const dir = fs.realpathSync(path.join(OUT_ROOT, "latest"));
    for (const f of ["v2-schema.sql", "v2-public.dump", "v2-public-data.dump", "v2-auth.dump", "snapshot.txt", "row-counts.tsv", "MANIFEST.sha256", "STORAGE-NOTE.md"]) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(spawnSync("sha256sum", ["-c", "--quiet", "MANIFEST.sha256"], { cwd: dir }).status).toBe(0);
    const counts = fs.readFileSync(path.join(dir, "row-counts.tsv"), "utf8");
    expect(counts).toMatch(/^touchpoints\t\d+\t301\t301$/m);
    expect(counts).toMatch(/^contacts\t\d+\t121\t121$/m);
  });

  it("02-discover documents tables, enum values and confirms every assumed column", () => {
    mustRun("migration/02-discover.sh");
    const md = fs.readFileSync(path.join(OUT_ROOT, "latest", "legacy-schema.md"), "utf8");
    expect(md).toContain("| touchpoints | 301 |");
    expect(md).toContain("public.touch_type | Call · Email · Text · Door Knock · Site Visit · Inspection");
    expect(md).toContain("| touchpoints.outcome | Connected — had a conversation |");
    expect(md).not.toContain("**MISSING**");
  });

  it("03-restore-legacy needs --yes, then loads the raw copy into schema legacy", async () => {
    const dry = run("migration/03-restore-legacy.sh");
    expect(dry.status).toBe(2);
    expect(await val(db, "select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'legacy' and c.relkind = 'r'")).toBe(0);

    mustRun("migration/03-restore-legacy.sh", ["--yes"]);
    expect(await val(db, "select count(*)::int from legacy.touchpoints")).toBe(301);
    expect(await val(db, "select count(*)::int from legacy.contacts")).toBe(121);
    expect(await val(db, "select count(*)::int from legacy.gmail_tokens")).toBe(1);
    // V2 enum columns arrive as text, V2 policies/functions do not come along.
    expect(await val(db, "select data_type from information_schema.columns where table_schema = 'legacy' and table_name = 'touchpoints' and column_name = 'type'")).toBe("text");
    expect(await val(db, "select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'legacy'")).toBe(0);
  }, 60_000);

  it("transforms are idempotent: two runs produce identical data", async () => {
    mustRun("migration/03b-transform.sh");
    const first = await val<string>(db, FINGERPRINT);
    mustRun("migration/03b-transform.sh");
    const second = await val<string>(db, FINGERPRINT);
    expect(second).toBe(first);

    const counts = await q(db, `
      select (select count(*)::int from public.account where source = 'dillyv2') accounts,
             (select count(*)::int from public.contact where source = 'dillyv2') contacts,
             (select count(*)::int from public.property where source = 'dillyv2') properties,
             (select count(*)::int from public.property_contact) links,
             (select count(*)::int from public.opportunity where source = 'dillyv2') opps,
             (select sum(value_estimate)::int from public.opportunity where source = 'dillyv2') opp_value,
             (select count(*)::int from public.touch where source = 'dillyv2') touches,
             (select count(*)::int from public.task where source = 'dillyv2') tasks`);
    expect(counts[0]).toEqual({ accounts: 36, contacts: 120, properties: 100, links: 133, opps: 18, opp_value: 372000, touches: 300, tasks: 173 });
    // Demo org rows are out of scope (LEGACY_ORG_ID) and its unmapped "Smoke Signal" outcome did not block FOX.
    expect(await val(db, "select count(*)::int from public.account where name like 'Demo%'")).toBe(0);
  }, 60_000);

  it("04-reconcile passes with zero FAIL rows", async () => {
    const r = mustRun("migration/04-reconcile.sh");
    expect(r.stderr).toMatch(/verdict: PASS/);
    const fails = await q(db, "select * from migration.reconcile() where status = 'FAIL'");
    expect(fails).toEqual([]);
    const checks = await q<{ check_name: string }>(db, "select distinct check_name from migration.reconcile()");
    const names = checks.map((c) => c.check_name);
    for (const n of ["row_count", "every_legacy_id_present", "opportunity_value_total", "touches_per_rep_per_week", "contacts_per_account",
                     "properties_per_account", "notes_length", "timestamp_sample", "unmapped_actors"]) {
      expect(names).toContain(n);
    }
    expect(await val(db, "select count(*)::int from migration.reconcile() where check_name = 'timestamp_sample' and status = 'PASS'")).toBe(10);
  }, 60_000);

  it("closes overdue follow-ups that already have a later touch (app.reconcile_tasks), with no new tasks or points", async () => {
    const expected = await val<number>(db, `
      select count(*)::int from legacy.follow_ups f
       where f.org_id = $1 and f.status = 'pending'
         and exists (select 1 from legacy.touchpoints t where t.contact_id = f.contact_id and t.created_at >= f.created_at)`, [FOX_ORG]);
    expect(expected).toBeGreaterThanOrEqual(100);
    const closed = await val<number>(db, `
      select count(*)::int from public.task k join legacy.follow_ups f on f.id::text = k.legacy_id
       where k.source = 'dillyv2' and f.status = 'pending' and k.status = 'done' and k.completed_by_touch_id is not null`);
    expect(closed).toBe(expected);
    expect(await val(db, "select count(*)::int from public.task where source = 'dillyv2' and status = 'open'")).toBe(150 - expected);
    expect(await val(db, "select count(*)::int from public.task where source = 'dillyv2' and status = 'open' and due_on < current_date")).toBe(150 - expected);
    expect(await val(db, "select count(*)::int from public.task where source <> 'dillyv2'")).toBe(0);
    expect(await val(db, "select count(*)::int from public.point_event")).toBe(0);
    // freshness stamps came from the migrated touches
    expect(await val(db, "select count(*)::int from public.account where source = 'dillyv2' and last_touch_at is not null")).toBeGreaterThan(30);
  });

  it("flags test rows and duplicate suggestions without dropping or merging anything", async () => {
    expect(await val(db, "select is_test from public.contact where notes = 'Follow up — test 3 test 3'")).toBe(true);
    expect(await val(db, "select is_test from public.property where address1 = '123 Test 2'")).toBe(true);
    expect(await val(db, "select is_test from public.account where name = 'CBRE — Austin (address TBD)'")).toBe(true);
    expect(await val(db, "select count(*)::int from migration.flagged_row f join public.task k on k.legacy_id = f.legacy_id where f.flag = 'test_row' and k.title = 'Follow up — test 3 test 3'")).toBe(1);
    expect(await val(db, "select count(*)::int from migration.flagged_row where flag = 'test_row'")).toBe(4);
    expect(await val(db, "select count(*)::int from migration.duplicate_suggestion where entity = 'contact'")).toBeGreaterThanOrEqual(4);
    expect(await val(db, "select count(*)::int from migration.duplicate_suggestion where entity = 'account'")).toBe(1);
    expect(await val(db, "select count(*)::int from migration.duplicate_suggestion where entity = 'property'")).toBe(1);
    expect(await val(db, "select count(*)::int from public.contact where duplicate_of is not null")).toBe(0);
    // the orphan contact (V2 account deleted) migrated unlinked and flagged
    expect(await val(db, "select account_id from public.contact where email = 'orphan@example.com'")).toBe(null);
    expect(await val(db, "select count(*)::int from migration.flagged_row where flag = 'orphan'")).toBeGreaterThanOrEqual(1);
  });

  it("maps V2 users by email; reps who have not signed in get invites and keep their touches via unmapped_actor", async () => {
    const colby = await val(db, "select profile_id is not null from migration.user_map where email = 'colby@foxroofing.co'");
    expect(colby).toBe(true);
    expect(await val(db, "select count(*)::int from public.membership m join public.tenant t on t.id = m.tenant_id where t.slug = 'fox'")).toBe(5);
    expect(await val(db, "select count(*)::int from public.invite i join public.tenant t on t.id = i.tenant_id where t.slug = 'fox' and i.email = 'dylan@foxroofing.co'")).toBe(1);
    const dylanTouches = await val<number>(db, "select count(*)::int from legacy.touchpoints where user_id = '00000000-0000-4000-8000-0000000000a4'");
    expect(dylanTouches).toBe(50);
    expect(await val(db, "select count(*)::int from public.touch where source = 'dillyv2' and user_id is null")).toBe(dylanTouches);
    expect(await val(db, "select count(*)::int from migration.unmapped_actor where role_column = 'actor' and legacy_email = 'dylan@foxroofing.co'")).toBe(dylanTouches);
    expect(await val(db, "select count(*)::int from migration.legacy_value where field = 'legacy_points' and legacy_table = 'profiles'")).toBe(6);
  });

  it("keeps Gmail provenance and inbound auto-replies", async () => {
    const gmailIds = await val<number>(db, "select count(distinct gmail_message_id)::int from legacy.touchpoints where org_id = $1 and gmail_message_id is not null", [FOX_ORG]);
    expect(await val(db, "select count(*)::int from public.touch where external_id like 'gmail:%'")).toBe(gmailIds);
    expect(await val(db, "select count(*)::int from migration.flagged_row where flag = 'duplicate_gmail_message'")).toBe(1);
    expect(await val(db, "select count(*)::int from public.touch where outcome = 'auto_reply' and direction = 'inbound'")).toBe(10);
    expect(await val(db, "select count(*)::int from migration.legacy_value where field = 'provenance' and value = 'gmail'")).toBe(40);
  });

  it("no row in public has source='dillyv2' without a legacy_id", async () => {
    const n = await val<number>(db, `
      select (select count(*) from public.account where source = 'dillyv2' and legacy_id is null)
           + (select count(*) from public.contact where source = 'dillyv2' and legacy_id is null)
           + (select count(*) from public.property where source = 'dillyv2' and legacy_id is null)
           + (select count(*) from public.opportunity where source = 'dillyv2' and legacy_id is null)
           + (select count(*) from public.touch where source = 'dillyv2' and legacy_id is null)
           + (select count(*) from public.task where source = 'dillyv2' and legacy_id is null)`);
    expect(Number(n)).toBe(0);
  });

  it("reconcile FAILs when a note is truncated or a row goes missing", async () => {
    await db.query("begin");
    try {
      await db.query("update public.contact set notes = left(notes, 10) where notes like 'PM in a meeting%' and legacy_id = (select min(legacy_id) from public.contact where notes like 'PM in a meeting%')");
      // (a property no touch points at: the touch ledger itself is append-only)
      await db.query(`delete from public.property where id = (select min(p.id::text)::uuid from public.property p
                        where p.source = 'dillyv2' and not exists (select 1 from public.touch t where t.property_id = p.id))`);
      const fails = await q<{ check_name: string; entity: string }>(db, "select check_name, entity from migration.reconcile() where status = 'FAIL'");
      const names = fails.map((f) => `${f.check_name}:${f.entity}`);
      expect(names).toContain("notes_length:contacts.notes");
      expect(names).toContain("row_count:properties -> property");
      expect(names).toContain("every_legacy_id_present:properties -> property");
    } finally {
      await db.query("rollback");
    }
  });

  it("preflight raises on an unmapped outcome and nothing is written", async () => {
    const before = await val<number>(db, "select count(*)::int from public.touch");
    const runsBefore = await val<number>(db, "select count(*)::int from migration.run_log");
    await db.query(`insert into legacy.touchpoints (id, org_id, contact_id, user_id, type, outcome, direction, source, created_at, updated_at)
                    select gen_random_uuid(), org_id, contact_id, user_id, 'Call', 'Left a smoke signal', 'outbound', 'manual', now(), now()
                      from legacy.touchpoints where org_id = $1 limit 1`, [FOX_ORG]);
    try {
      const r = run("migration/03b-transform.sh");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("unmapped touch_outcome value 'Left a smoke signal' (touchpoints.outcome, 1 rows)");
      expect(r.stderr).toMatch(/rolled back/);
      expect(await val(db, "select count(*)::int from public.touch")).toBe(before);
      expect(await val(db, "select count(*)::int from migration.run_log")).toBe(runsBefore);
    } finally {
      await db.query("delete from legacy.touchpoints where outcome = 'Left a smoke signal'");
    }
  }, 60_000);

  it("re-attributes touches once a missing rep signs in", async () => {
    await db.query("insert into auth.users(email) values ('dylan@foxroofing.co')");
    mustRun("migration/03b-transform.sh", ["--reattribute"]);
    expect(await val(db, "select count(*)::int from public.touch where source = 'dillyv2' and user_id is null")).toBe(0);
    expect(await val(db, "select count(*)::int from migration.unmapped_actor where resolved_profile_id is null")).toBe(0);
    expect(await val(db, "select count(*)::int from public.point_event")).toBe(0);
    const r = mustRun("migration/04-reconcile.sh");
    expect(r.stderr).toMatch(/verdict: PASS \(\d+ pass, 0 fail, 0 warn\)/);
  }, 60_000);

  it("06-delta brings rows written in V2 after the snapshot, archives replaced versions, and reconcile still passes", async () => {
    await v2.query(`insert into public.touchpoints (org_id, account_id, contact_id, user_id, type, outcome, direction, notes)
                    select org_id, account_id, id, '00000000-0000-4000-8000-0000000000a2', 'Site Visit', 'Met in Person', 'outbound', 'Logged after the snapshot'
                      from public.contacts where id = md5('contact5')::uuid`);
    await v2.query("update public.contacts set notes = 'Updated after the snapshot' where id = md5('contact7')::uuid");
    expect(run("migration/06-delta.sh").status).toBe(2);
    const r = mustRun("migration/06-delta.sh", ["--yes"]);
    expect(r.stderr).toMatch(/verdict: PASS/);
    expect(await val(db, "select count(*)::int from public.touch where source = 'dillyv2'")).toBe(301);
    expect(await val(db, "select count(*)::int from public.touch where notes = 'Logged after the snapshot'")).toBe(1);
    expect(await val(db, "select notes from public.contact where legacy_id = md5('contact7')::uuid::text")).toBe("Updated after the snapshot");
    expect(await val(db, "select count(*)::int from legacy._superseded where table_name = 'contacts'")).toBe(1);
    expect(await val(db, "select count(*)::int from legacy._snapshot where kind = 'delta'")).toBe(1);
  }, 90_000);

  it("05-freeze makes V2 read-only for app roles and 05-unfreeze restores it", async () => {
    const grants = path.join(OUT_ROOT, "v2-grants-before-freeze.sql");
    const refuse = run("psql", [NEW_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "migration/05-freeze-v2.sql"]);
    expect(refuse.status).not.toBe(0);
    expect(refuse.stderr).toMatch(/NEW Dilly database/);

    mustRun("psql", [V2_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `grants_file=${grants}`, "-f", "migration/05-freeze-v2.sql"]);
    expect(fs.readFileSync(grants, "utf8")).toMatch(/grant INSERT on table public\.touchpoints to authenticated;/);
    const tryWrite = () =>
      run("psql", [V2_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
        "begin; set local role authenticated; insert into public.territories(name) values ('freeze probe'); rollback;"]);
    const frozen = tryWrite();
    expect(frozen.status).not.toBe(0);
    expect(frozen.stderr).toMatch(/permission denied/);

    mustRun("psql", [V2_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `grants_file=${grants}`, "-f", "migration/05-unfreeze-v2.sql"]);
    expect(tryWrite().status).toBe(0);
  }, 60_000);
});
