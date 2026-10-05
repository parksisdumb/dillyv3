// Pins 20261004300000_field_kit.sql: Storage bucket/policies are a no-op on plain Postgres (and correct when the
// storage schema exists), geocode columns + address-change reset, and photos logged with a touch (touch.media →
// public.photo + site_walk_completed points).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

const MIGRATION = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261004300000_field_kit.sql"), "utf8");
const STORAGE_BLOCK = MIGRATION.slice(MIGRATION.indexOf("-- 4) Supabase Storage"));

describe("storage migration on plain Postgres", () => {
  it("there is no storage schema here, and the whole migration re-runs cleanly (idempotent, storage skipped)", async () => {
    await inTx(async (c) => {
      expect((await one<{ r: string | null }>(c, "select to_regclass('storage.objects')::text as r")).r).toBeNull();
      await c.query("set local client_min_messages = warning");
      await c.query(MIGRATION);
      expect((await one<{ n: number }>(c, "select count(*)::int as n from pg_namespace where nspname = 'storage'")).n).toBe(0);
    });
  });

  it("with a storage schema present: creates the private 'media' bucket and tenant-keyed object policies", async () => {
    await inTx(async (c) => {
      // Minimal stand-in for Supabase's storage schema.
      await c.query(`create schema storage;
        create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
        alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated;
        grant select, insert, update on storage.objects to authenticated;`);
      await c.query(STORAGE_BLOCK);
      await c.query(STORAGE_BLOCK); // idempotent
      const b = await one<{ public: boolean }>(c, "select public from storage.buckets where id = 'media'");
      expect(b.public).toBe(false);
      const pol = await c.query("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1");
      expect(pol.rows.map((r) => r.policyname)).toEqual(["dilly_media_insert", "dilly_media_select", "dilly_media_update"]);

      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const rep = await makeUser(c, fox, "fk-storage-rep@foxroofing.co");
      await c.query("insert into storage.objects(bucket_id, name) values ('media', $1), ('media', $2)", [`${tsg}/2026/10/x.jpg`, `${fox}/2026/10/y.jpg`]);
      await actAs(c, rep);
      await c.query("insert into storage.objects(bucket_id, name) values ('media', $1)", [`${fox}/2026/10/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`]);
      await c.query("savepoint s");
      await expect(c.query("insert into storage.objects(bucket_id, name) values ('media', $1)", [`${tsg}/2026/10/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`])).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s");
      await c.query("savepoint s2");
      await expect(c.query("insert into storage.objects(bucket_id, name) values ('other', $1)", [`${fox}/2026/10/c.jpg`])).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s2");
      const seen = await c.query("select name from storage.objects order by name");
      expect(seen.rows.every((r) => String(r.name).startsWith(fox))).toBe(true);
      expect(seen.rows).toHaveLength(2);
      await actAsService(c);
    });
  });
});

describe("geocode columns", () => {
  it("exist, are constrained, and an address change clears the cached pin", async () => {
    await inTx(async (c) => {
      const cols = await c.query("select column_name from information_schema.columns where table_schema='public' and table_name='property' and column_name in ('geocoded_at','geocode_source','lat','lng') order by 1");
      expect(cols.rows.map((r) => r.column_name)).toEqual(["geocode_source", "geocoded_at", "lat", "lng"]);
      const fox = await tenantId(c, "fox");
      const p = await one<{ id: string }>(
        c,
        "insert into public.property(tenant_id, name, address1, city, state, lat, lng, geocoded_at, geocode_source) values ($1,'Geo','1801 S Pleasant Valley Rd','Austin','TX',30.23,-97.71,now(),'census') returning id",
        [fox],
      );
      await c.query("savepoint s");
      await expect(c.query("update public.property set geocode_source = 'bing' where id = $1", [p.id])).rejects.toThrow(/property_geocode_source_chk/);
      await c.query("rollback to savepoint s");
      // Autocomplete picks (20261004600000_address_suggest.sql).
      for (const src of ["google", "photon"]) await c.query("update public.property set geocode_source = $2 where id = $1", [p.id, src]);
      await c.query("update public.property set geocode_source = 'census' where id = $1", [p.id]);

      await c.query("update public.property set name = 'Geo 2', roof_system = 'TPO' where id = $1", [p.id]);
      expect(await one(c, "select lat::float, geocode_source from public.property where id = $1", [p.id])).toEqual({ lat: 30.23, geocode_source: "census" });

      await c.query("update public.property set address1 = '1900 Aldrich St' where id = $1", [p.id]);
      expect(await one(c, "select lat, lng, geocoded_at, geocode_source from public.property where id = $1", [p.id])).toEqual({ lat: null, lng: null, geocoded_at: null, geocode_source: null });

      // Setting the address and the pin together keeps the pin.
      await c.query("update public.property set city = 'Dallas', lat = 32.7, lng = -96.8, geocode_source = 'manual' where id = $1", [p.id]);
      expect(await one(c, "select lat::float, geocode_source from public.property where id = $1", [p.id])).toEqual({ lat: 32.7, geocode_source: "manual" });
    });
  });
});

describe("photos logged with a touch", () => {
  it("a roof walk with photos lands on the building once and awards site_walk_completed; RLS + caption rules hold", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const rep = await makeUser(c, fox, "fk-photo-rep@foxroofing.co");
      const other = await makeUser(c, fox, "fk-photo-other@foxroofing.co");
      const mgr = await makeUser(c, fox, "fk-photo-mgr@foxroofing.co", "manager");
      const a = await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'Photo Walk Co') returning id", [fox]);
      const p = await one<{ id: string }>(c, "insert into public.property(tenant_id, account_id, name) values ($1,$2,'Bldg C') returning id", [fox, a.id]);
      const ph1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
      const ph2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
      const foreign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
      const media = [
        { kind: "photo", id: ph1, path: `${fox}/2026/10/${ph1}.jpg`, width: 1600, height: 1200, taken_at: "2026-10-04T15:00:00Z", caption: "West drain" },
        { kind: "photo", id: ph2, path: `${fox}/2026/10/${ph2}.jpg`, lat: 30.23, lng: -97.71 },
        { kind: "photo", id: foreign, path: `${tsg}/2026/10/${foreign}.jpg` }, // other tenant's key: ignored
      ];
      await actAs(c, rep);
      const t = await one<{ id: string }>(
        c,
        `insert into public.touch(tenant_id, user_id, account_id, property_id, channel, outcome, source, external_id, media)
         values ($1,$2,$3,$4,'roof_walk','met_in_person','field','idem:11111111-2222-4333-8444-555555555555',$5) returning id`,
        [fox, rep, a.id, p.id, JSON.stringify(media)],
      );
      const photos = await c.query("select id, property_id, account_id, touch_id, caption, created_by, lat::float from public.photo where touch_id = $1 order by id", [t.id]);
      expect(photos.rows).toEqual([
        { id: ph1, property_id: p.id, account_id: a.id, touch_id: t.id, caption: "West drain", created_by: rep, lat: null },
        { id: ph2, property_id: p.id, account_id: a.id, touch_id: t.id, caption: null, created_by: rep, lat: 30.23 },
      ]);
      const pts = await c.query("select event, points from public.point_event where touch_id = $1 order by event", [t.id]);
      expect(pts.rows.map((r) => r.event)).toContain("site_walk_completed");

      // Replay with the same idempotency key: the unique index rejects it (the action returns the original touch).
      await c.query("savepoint s");
      await expect(
        c.query(
          `insert into public.touch(tenant_id, user_id, account_id, property_id, channel, outcome, source, external_id, media)
           values ($1,$2,$3,$4,'roof_walk','met_in_person','field','idem:11111111-2222-4333-8444-555555555555',$5)`,
          [fox, rep, a.id, p.id, JSON.stringify(media)],
        ),
      ).rejects.toThrow(/touch_external_uq/);
      await c.query("rollback to savepoint s");
      expect((await one<{ n: number }>(c, "select count(*)::int as n from public.photo where property_id = $1", [p.id])).n).toBe(2);

      // Without photos, a roof walk earns no site-walk points.
      const t2 = await one<{ id: string }>(
        c,
        "insert into public.touch(tenant_id, user_id, account_id, property_id, channel, outcome, source) values ($1,$2,$3,$4,'roof_walk','met_in_person','field') returning id",
        [fox, rep, a.id, p.id],
      );
      expect((await c.query("select 1 from public.point_event where touch_id = $1 and event = 'site_walk_completed'", [t2.id])).rowCount).toBe(0);

      // Caption: the photographer can edit; another rep can't (0 rows); path is immutable.
      expect((await c.query("update public.photo set caption = 'Ponding, west drain' where id = $1", [ph1])).rowCount).toBe(1);
      await c.query("savepoint s3");
      await expect(c.query("update public.photo set path = $2 where id = $1", [ph1, `${fox}/2026/10/${ph2}.jpg`])).rejects.toThrow(/caption/);
      await c.query("rollback to savepoint s3");
      await actAs(c, other);
      expect((await c.query("update public.photo set caption = 'nope' where id = $1", [ph1])).rowCount).toBe(0);
      await actAs(c, mgr);
      expect((await c.query("update public.photo set caption = 'Manager fix' where id = $1", [ph1])).rowCount).toBe(1);

      // Another tenant's rep sees none of it.
      await actAsService(c);
      const tsgRep = await makeUser(c, tsg, "fk-photo-tsg@thesvcgroup.com");
      await actAs(c, tsgRep);
      expect((await c.query("select 1 from public.photo where property_id = $1", [p.id])).rowCount).toBe(0);
      await c.query("savepoint s4");
      await expect(
        c.query("insert into public.photo(id, tenant_id, path, created_by) values ($1,$2,$3,$4)", ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", fox, `${fox}/2026/10/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9.jpg`, tsgRep]),
      ).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s4");
      await actAsService(c);
    });
  });

  it("a photo path must live under its own tenant", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      await expect(
        c.query("insert into public.photo(id, tenant_id, path) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10', $1, $2)", [fox, `${tsg}/2026/10/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10.jpg`]),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it("the card-scan agent is registered (agent_run FK)", async () => {
    await inTx(async (c) => {
      expect(await one(c, "select default_tier, enabled from public.agent where key = 'card-scan'")).toEqual({ default_tier: "sonnet", enabled: true });
    });
  });
});

describe("photo guard", () => {
  it("deleting the touch unlinks its photos (ON DELETE SET NULL) instead of failing", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const a = await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'Guard Co') returning id", [fox]);
      const ph = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01";
      const t = await one<{ id: string }>(
        c,
        "insert into public.touch(tenant_id, account_id, channel, outcome, source, media) values ($1,$2,'inspection','other','import',$3) returning id",
        [fox, a.id, JSON.stringify([{ kind: "photo", id: ph, path: `${fox}/2026/10/${ph}.jpg` }])],
      );
      expect((await one<{ touch_id: string }>(c, "select touch_id from public.photo where id = $1", [ph])).touch_id).toBe(t.id);
      await c.query("delete from public.touch where id = $1", [t.id]);
      expect((await one<{ touch_id: string | null }>(c, "select touch_id from public.photo where id = $1", [ph])).touch_id).toBeNull();
      await expect(c.query("update public.photo set touch_id = $2 where id = $1", [ph, t.id])).rejects.toThrow();
    });
  });
});
