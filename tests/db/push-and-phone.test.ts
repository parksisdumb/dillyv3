// Pins 20261004100500_push_subscription_and_phone_search.sql: reps manage only their own push devices, an endpoint
// is handed over when someone else subscribes on the same browser, and phone search works on digits only.
import { describe, expect, it } from "vitest";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

const sub = (n: string) => [`https://push.example/${n}`, "p256", "auth", "test-agent"];

describe("push_subscription", () => {
  it("a rep sees and changes only their own devices", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const a = await makeUser(c, fox, "push-a@foxroofing.co");
      const b = await makeUser(c, fox, "push-b@foxroofing.co");
      await actAs(c, a);
      await c.query("select public.save_push_subscription($1,$2,$3,$4,$5)", [fox, ...sub("a1")]);
      await actAsService(c);
      await actAs(c, b);
      await c.query("select public.save_push_subscription($1,$2,$3,$4,$5)", [fox, ...sub("b1")]);
      const mine = await c.query("select endpoint from public.push_subscription");
      expect(mine.rows.map((r) => r.endpoint)).toEqual(["https://push.example/b1"]);
      const del = await c.query("delete from public.push_subscription where endpoint = $1", ["https://push.example/a1"]);
      expect(del.rowCount).toBe(0);
      await c.query("savepoint x");
      await expect(
        c.query("insert into public.push_subscription(tenant_id,user_id,endpoint,p256dh,auth) values ($1,$2,'https://push.example/x','p','a')", [fox, a]),
      ).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint x");
    });
  });

  it("re-subscribing the same browser as another user hands the endpoint over and re-enables it", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const a = await makeUser(c, fox, "push-c@foxroofing.co");
      const b = await makeUser(c, fox, "push-d@foxroofing.co");
      await actAs(c, a);
      const id = (await one<{ id: string }>(c, "select public.save_push_subscription($1,$2,$3,$4,$5) as id", [fox, ...sub("shared")])).id;
      await actAsService(c);
      await c.query("update public.push_subscription set disabled_at = now(), failure_count = 4 where id = $1", [id]);
      await actAs(c, b);
      await c.query("select public.save_push_subscription($1,$2,$3,$4,$5)", [fox, ...sub("shared")]);
      await actAsService(c);
      const row = await one<{ user_id: string; disabled_at: string | null; failure_count: number }>(
        c,
        "select user_id, disabled_at, failure_count from public.push_subscription where id = $1",
        [id],
      );
      expect(row).toEqual({ user_id: b, disabled_at: null, failure_count: 0 });
    });
  });

  it("can't subscribe into a tenant you're not a member of", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const a = await makeUser(c, fox, "push-e@foxroofing.co");
      await actAs(c, a);
      await expect(c.query("select public.save_push_subscription($1,$2,$3,$4,$5)", [tsg, ...sub("e1")])).rejects.toThrow(/not a member/);
    });
  });
});

describe("contact.phone_digits", () => {
  it("holds the digits of phone and mobile, so any formatting matches", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const ct = await one<{ id: string; phone_digits: string }>(
        c,
        "insert into public.contact(tenant_id, first_name, phone, mobile) values ($1,'Pat','(512) 555-0134','+1 214.555.9876') returning id, phone_digits",
        [fox],
      );
      expect(ct.phone_digits).toBe("5125550134 12145559876");
      const hit = await c.query("select id from public.contact where tenant_id = $1 and phone_digits ilike '%2145559876%'", [fox]);
      expect(hit.rows.map((r) => r.id)).toContain(ct.id);
    });
  });
});
