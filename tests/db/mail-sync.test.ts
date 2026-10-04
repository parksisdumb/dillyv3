// Gmail sync, database side (20261004100600_mail_connection.sql + 20261004100700_mail_touch_guard.sql):
// synced touches go through public.mail_ingest and the touch trigger — a reply closes the open follow-up and
// schedules "Respond to X" without awarding the rep points; outbound earns touch_logged only; auto-replies and
// bounces don't close follow-ups; idempotent; V2-migrated messages are skipped; secrets are service-role only.
import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

async function setup(c: Client, tag: string) {
  const fox = await tenantId(c, "fox");
  const rep = await makeUser(c, fox, `mail-${tag}@foxroofing.co`);
  const acct = await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1, $2) returning id", [fox, `Mail ${tag} Co`]);
  const contact = async (first: string, email: string) =>
    (
      await one<{ id: string }>(
        c,
        "insert into public.contact(tenant_id, account_id, first_name, last_name, email) values ($1,$2,$3,'Mailtest',$4) returning id",
        [fox, acct.id, first, email],
      )
    ).id;
  return { fox, rep, acct: acct.id, contact };
}

async function openFollowUp(c: Client, fox: string, rep: string, acct: string, contactId: string, title = "Follow up on email") {
  return (
    await one<{ id: string }>(
      c,
      `insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, kind, title, due_on, created_at)
       values ($1,$2,$3,$4,'follow_up',$5, current_date, now() - interval '2 days') returning id`,
      [fox, rep, acct, contactId, title],
    )
  ).id;
}

const row = (o: Record<string, unknown>) => ({
  direction: "inbound",
  outcome: "replied",
  notes: "Re: Roof bid",
  skip_follow_up: false,
  occurred_at: new Date().toISOString(),
  ...o,
});

async function ingest(c: Client, fox: string, rep: string, rows: unknown[]) {
  return (await one<{ r: Record<string, number> }>(c, "select public.mail_ingest($1,$2,'gmail',$3::jsonb) as r", [fox, rep, JSON.stringify(rows)])).r;
}

async function points(c: Client, touchExternalId: string, fox: string) {
  const r = await c.query(
    "select pe.event from public.point_event pe join public.touch t on t.id = pe.touch_id where t.tenant_id = $1 and t.source = 'gmail' and t.external_id = $2 order by 1",
    [fox, touchExternalId],
  );
  return r.rows.map((x) => x.event);
}

describe("mail_ingest + touch trigger", () => {
  it("an inbound reply closes the open follow-up, creates a high-priority 'Respond to' task, and awards nothing", async () => {
    await inTx(async (c) => {
      const { fox, rep, acct, contact } = await setup(c, "reply");
      const pat = await contact("Pat", "Pat.Reply@Acme.com");
      const fu = await openFollowUp(c, fox, rep, acct, pat);

      const r = await ingest(c, fox, rep, [row({ external_id: "msg-reply-1", provider_message_id: "msg-reply-1", contact_id: pat })]);
      expect(r).toMatchObject({ inserted: 1, duplicates: 0 });

      const t = await one<{ id: string; user_id: string; channel: string; direction: string; outcome: string; notes: string; account_id: string }>(
        c,
        "select id, user_id, channel, direction, outcome, notes, account_id from public.touch where tenant_id = $1 and source = 'gmail' and external_id = 'msg-reply-1'",
        [fox],
      );
      expect(t).toMatchObject({ user_id: rep, channel: "email", direction: "inbound", outcome: "replied", notes: "Re: Roof bid", account_id: acct });

      const old = await one<{ status: string; completed_by_touch_id: string }>(c, "select status, completed_by_touch_id from public.task where id = $1", [fu]);
      expect(old).toEqual({ status: "done", completed_by_touch_id: t.id });

      const next = await one<{ title: string; priority: number; status: string; assignee_user_id: string; contact_id: string }>(
        c,
        "select title, priority, status, assignee_user_id, contact_id from public.task where created_from_touch_id = $1",
        [t.id],
      );
      expect(next).toEqual({ title: "Respond to Pat Mailtest", priority: 85, status: "open", assignee_user_id: rep, contact_id: pat });

      expect(await points(c, "msg-reply-1", fox)).toEqual([]); // no touch_logged, no connect, no follow_up_on_time
    });
  });

  it("outbound synced mail earns touch_logged only; backfilled (older than 24 h) earns nothing", async () => {
    await inTx(async (c) => {
      const { fox, rep, acct, contact } = await setup(c, "out");
      const a = await contact("Ann", "ann.out@acme.com");
      const b = await contact("Ben", "ben.out@acme.com");
      await openFollowUp(c, fox, rep, acct, a); // would be follow_up_on_time for a rep-logged touch
      await ingest(c, fox, rep, [
        row({ external_id: "msg-out-1", provider_message_id: "msg-out-1", contact_id: a, direction: "outbound", outcome: "sent", notes: "Roof bid" }),
        row({
          external_id: "msg-out-old",
          provider_message_id: "msg-out-old",
          contact_id: b,
          direction: "outbound",
          outcome: "sent",
          occurred_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          skip_follow_up: true,
        }),
      ]);
      expect(await points(c, "msg-out-1", fox)).toEqual(["touch_logged"]);
      expect(await points(c, "msg-out-old", fox)).toEqual([]);
      const fu = await one<{ title: string }>(
        c,
        "select title from public.task t join public.touch x on x.id = t.created_from_touch_id where x.external_id = 'msg-out-1' and x.tenant_id = $1",
        [fox],
      );
      expect(fu.title).toBe("Follow up on email to Ann Mailtest");
      const none = await c.query("select 1 from public.task t join public.touch x on x.id = t.created_from_touch_id where x.external_id = 'msg-out-old' and x.tenant_id = $1", [fox]);
      expect(none.rowCount).toBe(0);
    });
  });

  it("auto-replies and bounces don't close the follow-up; a bounce marks the address bounced", async () => {
    await inTx(async (c) => {
      const { fox, rep, acct, contact } = await setup(c, "auto");
      const ooo = await contact("Olive", "olive.ooo@acme.com");
      const gone = await contact("Gus", "gus.gone@acme.com");
      const fu1 = await openFollowUp(c, fox, rep, acct, ooo);
      const fu2 = await openFollowUp(c, fox, rep, acct, gone);
      await ingest(c, fox, rep, [
        row({ external_id: "msg-ooo", provider_message_id: "msg-ooo", contact_id: ooo, outcome: "auto_reply", notes: "Automatic reply: Roof bid" }),
        row({ external_id: "msg-bounce", provider_message_id: "msg-bounce", contact_id: gone, outcome: "bounced", notes: "Delivery Status Notification (Failure)" }),
      ]);
      const st = await c.query("select id, status from public.task where id = any($1)", [[fu1, fu2]]);
      expect(st.rows.every((r) => r.status === "open")).toBe(true);
      expect((await one<{ email_status: string }>(c, "select email_status from public.contact where id = $1", [gone])).email_status).toBe("bounced");
      expect(await points(c, "msg-ooo", fox)).toEqual([]);
      expect(await points(c, "msg-bounce", fox)).toEqual([]);
    });
  });

  it("is idempotent, skips messages Dilly V2 already logged, and refuses contacts from another tenant", async () => {
    await inTx(async (c) => {
      const { fox, rep, acct, contact } = await setup(c, "idem");
      const pat = await contact("Pia", "pia.idem@acme.com");
      const tsg = await tenantId(c, "tsg");
      const other = await one<{ id: string }>(c, "insert into public.contact(tenant_id, first_name, email) values ($1,'Other','pia.idem@acme.com') returning id", [tsg]);
      await c.query(
        "insert into public.touch(tenant_id, user_id, account_id, contact_id, channel, outcome, source, external_id, occurred_at) values ($1,$2,$3,$4,'email','sent','dillyv2','gmail:msg-v2', now() - interval '5 days')",
        [fox, rep, acct, pat],
      );
      const rows = [
        row({ external_id: "msg-idem", provider_message_id: "msg-idem", contact_id: pat }),
        row({ external_id: "msg-v2", provider_message_id: "msg-v2", contact_id: pat, direction: "outbound", outcome: "sent" }),
        row({ external_id: "msg-x", provider_message_id: "msg-x", contact_id: other.id }),
      ];
      expect(await ingest(c, fox, rep, rows)).toEqual({ inserted: 1, duplicates: 0, already_in_v2: 1, invalid: 1 });
      expect(await ingest(c, fox, rep, rows)).toEqual({ inserted: 0, duplicates: 1, already_in_v2: 1, invalid: 1 });
      const n = await one<{ n: number }>(c, "select count(*)::int n from public.touch where tenant_id = $1 and source = 'gmail' and external_id = 'msg-idem'", [fox]);
      expect(n.n).toBe(1);
    });
  });

  it("rep-logged touches are unchanged: a logged reply still scores touch_logged + connect", async () => {
    await inTx(async (c) => {
      const { fox, rep, acct, contact } = await setup(c, "rep");
      const r = await contact("Rae", "rae.rep@acme.com");
      const t = await one<{ id: string }>(
        c,
        "insert into public.touch(tenant_id, user_id, account_id, contact_id, channel, direction, outcome) values ($1,$2,$3,$4,'email','inbound','replied') returning id",
        [fox, rep, acct, r],
      );
      const ev = await c.query("select event from public.point_event where touch_id = $1 order by 1", [t.id]);
      expect(ev.rows.map((x) => x.event)).toEqual(["connect", "touch_logged"]);
    });
  });
});

describe("mail_connection security", () => {
  it("tokens are service-role only; a user reads only their own non-secret columns through my_mail_connection", async () => {
    await inTx(async (c) => {
      const { fox, rep } = await setup(c, "sec");
      const other = await makeUser(c, fox, "mail-sec-other@foxroofing.co");
      await c.query(
        `insert into public.mail_connection(tenant_id, user_id, provider, email, refresh_token_encrypted, access_token_encrypted)
         values ($1,$2,'google','mail-sec@foxroofing.co','v1:AAAA','v1:BBBB'), ($1,$3,'google','other@foxroofing.co','v1:CCCC',null)`,
        [fox, rep, other],
      );
      // Plaintext can never be stored.
      await c.query("savepoint p");
      await expect(c.query("update public.mail_connection set refresh_token_encrypted = '1//plain' where user_id = $1", [rep])).rejects.toThrow(/mail_connection_refresh_encrypted/);
      await c.query("rollback to savepoint p");

      await actAs(c, rep);
      const mine = await c.query("select * from public.my_mail_connection");
      expect(mine.rows).toHaveLength(1);
      expect(Object.keys(mine.rows[0]).sort()).toEqual(["email", "id", "last_error", "last_synced_at", "provider", "status", "tenant_id"]);
      expect(mine.rows[0].email).toBe("mail-sec@foxroofing.co");

      await c.query("savepoint a");
      await expect(c.query("select refresh_token_encrypted from public.mail_connection")).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint a");
      await c.query("savepoint b");
      await expect(c.query("select * from public.mail_connection")).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint b");
      await c.query("savepoint c");
      await expect(c.query("update public.mail_connection set status = 'active' where user_id = $1", [rep])).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint c");
      await c.query("savepoint d");
      await expect(c.query("select public.mail_ingest($1,$2,'gmail','[]'::jsonb)", [fox, rep])).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint d");
      const base = await c.query("select id, email from public.mail_connection");
      expect(base.rows.map((r) => r.email)).toEqual(["mail-sec@foxroofing.co"]); // RLS: own row only
      await actAsService(c);
    });
  });
});
