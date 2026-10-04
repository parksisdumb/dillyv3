import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Db } from "@/agents/runtime/db";
import type { PushDecision, RankedItem } from "@/agents/rep-daily-brief/rank";
import { runRemindersForRep, type PushSender, type ReminderDeps } from "@/agents/rep-daily-brief/reminders";
import { vapidConfig } from "@/lib/push/config";
import { notificationFor, itemUrl } from "@/lib/push/copy";
import { createWebPushSender, defaultPushSender, type WebPushClient } from "@/lib/push/sender";
import { clock12, deviceLabel, shouldShowInstallHint } from "@/lib/push/device";
import { phoneDigitsClause, phoneSearchDigits } from "@/lib/domain/phone-search";
import manifest from "@/app/manifest";
import { memoryStore, repContext, task } from "../agents/fixtures";

const VAPID = { publicKey: "BPub", privateKey: "priv", subject: "mailto:team@dillyos.com" };

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; failure_count: number };

/** Minimal supabase-js stand-in: push_subscription select + update(...).eq("id"), insert for insight. */
function fakeDb(subs: Sub[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const filters: [string, unknown][] = [];
  const inserts: { table: string; rows: unknown }[] = [];
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      in: () => q,
      gte: () => q,
      is: (k: string, v: unknown) => (filters.push([`is:${k}`, v]), q),
      eq: (k: string, v: unknown) => {
        if (patch && k === "id") {
          updates.push({ id: v as string, patch });
          return Promise.resolve({ data: null, error: null });
        }
        filters.push([k, v]);
        return q;
      },
      update: (p: Record<string, unknown>) => ((patch = p), q),
      insert: (rows: unknown) => (inserts.push({ table, rows }), Promise.resolve({ data: null, error: null })),
      then: (res: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: table === "push_subscription" ? subs : [], error: null }).then(res),
    };
    return q;
  };
  return { db: { from } as unknown as Db, updates, filters, inserts };
}

function fakeClient(behaviour: Record<string, number | "ok">) {
  const calls: { endpoint: string; payload: unknown; options: Parameters<WebPushClient["sendNotification"]>[2] }[] = [];
  const client: WebPushClient = {
    async sendNotification(sub, payload, options) {
      calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
      const b = behaviour[sub.endpoint] ?? "ok";
      if (b === "ok") return { statusCode: 201 };
      throw Object.assign(new Error(`push ${b}`), { statusCode: b });
    },
  };
  return { client, calls };
}

const sub = (id: string, failure_count = 0): Sub => ({ id, endpoint: `https://push.example/${id}`, p256dh: "p", auth: "a", failure_count });

const DUE: PushDecision = {
  key: "due:t-1",
  kind: "due_today_big",
  at: "08:00",
  dueNow: true,
  title: "Greystar Riverside — Call Dave back",
  body: "Due today · P1, $160K proposal",
  itemKeys: ["task:t-1"],
};
const ITEM: Pick<RankedItem, "key" | "type" | "title" | "accountId" | "accountName" | "opportunityId"> = {
  key: "task:t-1",
  type: "task",
  title: "Call Dave back",
  accountId: "acct-1",
  accountName: "Greystar Riverside",
  opportunityId: null,
};

describe("web push sender", () => {
  it("sends to every active device, records success, disables on 410/404, counts other failures", async () => {
    const f = fakeDb([sub("a"), sub("gone"), sub("missing"), sub("flaky", 2)]);
    const { client, calls } = fakeClient({ "https://push.example/gone": 410, "https://push.example/missing": 404, "https://push.example/flaky": 500 });
    const at = new Date("2026-10-05T13:00:00Z");
    const sender = createWebPushSender({ db: f.db, vapid: VAPID, client, now: () => at });

    const r = await sender.send({ tenantId: "t", userId: "u", push: DUE, notification: notificationFor(DUE, [ITEM]) });

    expect(r).toEqual({ delivered: true, channel: "webpush", devices: 4, sent: 1, failed: 1, disabled: 2 });
    expect(f.filters).toEqual(expect.arrayContaining([["tenant_id", "t"], ["user_id", "u"], ["is:disabled_at", null]]));
    expect(calls).toHaveLength(4);
    expect(calls[0].payload).toEqual({ title: "Call Dave back — Greystar Riverside", body: "Due today · P1, $160K proposal", url: "/app/accounts/acct-1", tag: "dilly:due:t-1" });
    expect(calls[0].options).toMatchObject({ vapidDetails: VAPID, TTL: 4 * 3600 });
    const byId = Object.fromEntries(f.updates.map((u) => [u.id, u.patch]));
    expect(byId.a).toEqual({ last_success_at: at.toISOString(), failure_count: 0 });
    expect(byId.gone).toEqual({ disabled_at: at.toISOString() });
    expect(byId.missing).toEqual({ disabled_at: at.toISOString() });
    expect(byId.flaky).toEqual({ failure_count: 3 });
  });

  it("410 on the only device: not delivered, subscription disabled", async () => {
    const f = fakeDb([sub("only")]);
    const { client } = fakeClient({ "https://push.example/only": 410 });
    const r = await createWebPushSender({ db: f.db, vapid: VAPID, client }).send({ tenantId: "t", userId: "u", push: DUE });
    expect(r).toMatchObject({ delivered: false, devices: 1, sent: 0, disabled: 1 });
    expect(f.updates).toEqual([{ id: "only", patch: { disabled_at: expect.any(String) } }]);
  });

  it("no devices: nothing sent, not delivered", async () => {
    const f = fakeDb([]);
    const { client, calls } = fakeClient({});
    const r = await createWebPushSender({ db: f.db, vapid: VAPID, client }).send({ tenantId: "t", userId: "u", push: DUE });
    expect(r).toMatchObject({ delivered: false, devices: 0 });
    expect(calls).toHaveLength(0);
  });

  it("no VAPID env → no web push sender (record-only fallback)", async () => {
    expect(await defaultPushSender(fakeDb([]).db, {})).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "x" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y" })).toEqual({ publicKey: "x", privateKey: "y", subject: "mailto:team@dillyos.com" });
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y", VAPID_SUBJECT: "https://dillyos.com" })?.subject).toBe("https://dillyos.com");
  });
});

describe("reminders → PushSender wiring", () => {
  const thu8 = new Date("2026-10-08T13:00:00Z"); // Thu 08:00 Chicago

  it("passes tappable copy for the exact item and records the delivery result", async () => {
    const f = fakeDb([]);
    const mem = memoryStore();
    const ctx = repContext({ forDate: "2026-10-08", queue: [task({ icp_tier: 1, due_on: "2026-10-08" })] });
    const seen: Parameters<PushSender["send"]>[0][] = [];
    const sender: PushSender = {
      async send(a) {
        seen.push(a);
        return { delivered: true, channel: "webpush", devices: 1, sent: 1 };
      },
    };
    const deps: ReminderDeps = { db: f.db, store: mem.store, transport: null, loader: async () => ctx, sentToday: async () => [], sender };
    const res = await runRemindersForRep({ tenant: ctx.tenant, userId: "user-1", now: thu8 }, deps);
    expect(res.pushes).toHaveLength(1);
    expect(seen).toHaveLength(1);
    const acct = ctx.queue[0].account_id;
    expect(seen[0].notification).toMatchObject({ url: `/app/accounts/${acct}`, tag: `dilly:${res.pushes[0].key}` });
    expect(seen[0].notification!.title).toMatch(/ — /);
    expect(f.inserts[0].table).toBe("insight"); // insight logging kept
  });

  it("a sender that throws doesn't lose the recorded reminder", async () => {
    const f = fakeDb([]);
    const mem = memoryStore();
    const ctx = repContext({ forDate: "2026-10-08", queue: [task({ icp_tier: 1, due_on: "2026-10-08" })] });
    const sender: PushSender = {
      async send() {
        throw new Error("push service down");
      },
    };
    const res = await runRemindersForRep(
      { tenant: ctx.tenant, userId: "user-1", now: thu8 },
      { db: f.db, store: mem.store, transport: null, loader: async () => ctx, sentToday: async () => [], sender },
    );
    expect(res.runId).not.toBeNull();
    expect(f.inserts.find((i) => i.table === "insight")).toBeTruthy();
  });
});

describe("notification copy", () => {
  it("overdue group opens Today; signal opens the account; opportunity opens the job", () => {
    const overdue: PushDecision = { ...DUE, key: "overdue:2026-10-05", kind: "overdue_group", title: "3 overdue", body: "3 overdue, top: Greystar — Call Dave", itemKeys: ["a", "b", "c"] };
    expect(notificationFor(overdue)).toMatchObject({ title: "3 overdue follow-ups", url: "/app/today" });
    const sig: PushDecision = { ...DUE, key: "signal:s1", kind: "signal", title: "Greystar: replied", itemKeys: ["signal:s1"] };
    expect(notificationFor(sig, [{ ...ITEM, key: "signal:s1", type: "signal" }]).url).toBe("/app/accounts/acct-1");
    expect(itemUrl({ ...ITEM, type: "opportunity", opportunityId: "opp-9" })).toBe("/app/pipeline/opp-9");
    expect(itemUrl(undefined)).toBe("/app/today");
  });
});

describe("PWA manifest", () => {
  const m = manifest();
  it("has the name, start URL, display and colors", () => {
    expect(m).toMatchObject({ name: "Dilly", short_name: "Dilly", start_url: "/app/today", display: "standalone", background_color: "#F5F6F3" });
    expect(m.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it("lists 192 and 512 icons, any + maskable, and the files exist", () => {
    const icons = m.icons ?? [];
    for (const size of ["192x192", "512x512"]) {
      for (const purpose of ["any", "maskable"]) expect(icons.some((i) => i.sizes === size && i.purpose === purpose)).toBe(true);
    }
    for (const i of icons) expect(existsSync(path.join(__dirname, "../../public", i.src))).toBe(true);
    expect(existsSync(path.join(__dirname, "../../public/icons/apple-touch-icon.png"))).toBe(true);
    expect(existsSync(path.join(__dirname, "../../public/sw.js"))).toBe(true);
  });
});

describe("helpers", () => {
  it("phone search digits ignore formatting and the US country code", () => {
    expect(phoneSearchDigits("(512) 555-0134")).toBe("5125550134");
    expect(phoneSearchDigits("+1 512.555.0134")).toBe("5125550134");
    expect(phoneSearchDigits("555")).toBeNull();
    expect(phoneSearchDigits("Dave 5550")).toBeNull();
    expect(phoneDigitsClause("512-555")).toBe(",phone_digits.ilike.%512555%");
    expect(phoneDigitsClause("Greystar")).toBe("");
  });
  it("device labels and 12-hour clock", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceLabel(null)).toBe("Unknown device");
    expect(clock12("07:00")).toBe("7 AM");
    expect(clock12("19:30")).toBe("7:30 PM");
    expect(clock12("12:00")).toBe("12 PM");
  });
  it("install hint only for iOS Safari outside the home-screen app", () => {
    const iosSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(shouldShowInstallHint({ userAgent: iosSafari }, false)).toBe(true);
    expect(shouldShowInstallHint({ userAgent: iosSafari, standalone: true }, false)).toBe(false);
    expect(shouldShowInstallHint({ userAgent: iosSafari }, true)).toBe(false);
    expect(shouldShowInstallHint({ userAgent: iosSafari.replace("Version/18.0", "CriOS/129.0") }, false)).toBe(false);
    expect(shouldShowInstallHint({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36" }, false)).toBe(false);
  });
});
