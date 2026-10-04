import { describe, expect, it } from "vitest";
import {
  buildTouchRows,
  classify,
  cleanSubject,
  counterparts,
  decodeMimeWords,
  dedupeKey,
  findAddresses,
  internalDomains,
  lookupAddresses,
  parseAddressList,
  type ContactMatch,
} from "./classify";
import type { MailMessage } from "./provider";

const ME = "colby@foxroofing.co";
const INTERNAL = ["foxroofing.co"];
const T0 = Date.parse("2026-10-01T15:00:00Z");

function msg(id: string, headers: Record<string, string>, labels: string[] = ["INBOX"], at = T0): MailMessage {
  return { id, internalDate: at, labels, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
}

describe("parseAddressList", () => {
  it("handles display names, quoted commas, bare addresses, case and duplicates", () => {
    expect(parseAddressList(`"Smith, Ann" <Ann.Smith@Acme.com>, bob@acme.com, Carl <carl@x.io>, ann.smith@acme.com`)).toEqual([
      "ann.smith@acme.com",
      "bob@acme.com",
      "carl@x.io",
    ]);
  });
  it("handles comments, groups and empty groups", () => {
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList("Team: a@b.com, c@d.com;")).toEqual(["a@b.com", "c@d.com"]);
    expect(parseAddressList("dana@e.com (Dana, PM)")).toEqual(["dana@e.com"]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe("header decoding", () => {
  it("decodes RFC 2047 B and Q words", () => {
    expect(decodeMimeWords("=?UTF-8?B?Um9vZiBiaWQg4oCUIExpbmNvbG4=?=")).toBe("Roof bid — Lincoln");
    expect(decodeMimeWords("=?utf-8?Q?Caf=C3=A9_walk?= =?utf-8?Q?_Friday?=")).toBe("Café walk Friday");
  });
  it("cleans subjects and never returns empty", () => {
    expect(cleanSubject("  Re:\r\n  roof  ")).toBe("Re: roof");
    expect(cleanSubject("")).toBe("(no subject)");
    expect(cleanSubject("x".repeat(400))).toHaveLength(300);
  });
  it("finds addresses anywhere in a string", () => {
    expect(findAddresses("Undeliverable: Bid for PM@Acme.com and x@y.org")).toEqual(["pm@acme.com", "x@y.org"]);
  });
});

describe("classify", () => {
  it("sent: SENT label or From is the user", () => {
    expect(classify(msg("1", { From: "Colby <colby@foxroofing.co>", To: "pm@acme.com" }, ["SENT"]), ME)).toBe("sent");
    expect(classify(msg("2", { From: "COLBY@foxroofing.co", To: "pm@acme.com" }, []), ME)).toBe("sent");
  });
  it("reply: a human wrote back", () => {
    expect(classify(msg("3", { From: "Pat <pm@acme.com>", To: ME, Subject: "Re: roof walk", "In-Reply-To": "<a@b>" }), ME)).toBe("reply");
  });
  it("auto-reply: Auto-Submitted, X-Autoreply, Precedence, OOO subjects", () => {
    expect(classify(msg("4", { From: "pm@acme.com", Subject: "Re: bid", "Auto-Submitted": "auto-replied" }), ME)).toBe("auto_reply");
    expect(classify(msg("5", { From: "pm@acme.com", Subject: "Re: bid", "Auto-Submitted": "no" }), ME)).toBe("reply");
    expect(classify(msg("6", { From: "pm@acme.com", Subject: "Hello", "X-Autoreply": "yes" }), ME)).toBe("auto_reply");
    expect(classify(msg("7", { From: "pm@acme.com", Subject: "Hi", Precedence: "auto_reply" }), ME)).toBe("auto_reply");
    expect(classify(msg("8", { From: "pm@acme.com", Subject: "Automatic reply: Roof bid" }), ME)).toBe("auto_reply");
    expect(classify(msg("9", { From: "pm@acme.com", Subject: "Out of Office: back Monday" }), ME)).toBe("auto_reply");
  });
  it("bounce: mailer-daemon / postmaster / DSN subjects", () => {
    expect(classify(msg("10", { From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", Subject: "Delivery Status Notification (Failure)", "Auto-Submitted": "auto-replied" }), ME)).toBe(
      "bounce",
    );
    expect(classify(msg("11", { From: "postmaster@acme.com", Subject: "Undeliverable: Roof bid" }), ME)).toBe("bounce");
  });
  it("ignore: drafts, spam, promotions, social, chats", () => {
    for (const l of ["DRAFT", "SPAM", "TRASH", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CHAT"]) {
      expect(classify(msg("12", { From: "pm@acme.com" }, ["INBOX", l]), ME)).toBe("ignore");
    }
  });
});

describe("counterparts", () => {
  it("sent → To + Cc minus me and colleagues", () => {
    const m = msg("1", { From: ME, To: "pm@acme.com, tyler@foxroofing.co", Cc: "Owner <owner@acme.com>, colby@foxroofing.co" }, ["SENT"]);
    expect(counterparts(m, "sent", ME, INTERNAL)).toEqual(["pm@acme.com", "owner@acme.com"]);
  });
  it("received → From only (Cc'd people aren't the counterpart)", () => {
    const m = msg("2", { From: "pm@acme.com", To: ME, Cc: "other@acme.com" });
    expect(counterparts(m, "reply", ME, INTERNAL)).toEqual(["pm@acme.com"]);
  });
  it("a colleague's mail is never a touch", () => {
    expect(counterparts(msg("3", { From: "tyler@foxroofing.co", To: ME }), "reply", ME, INTERNAL)).toEqual([]);
  });
  it("bounce → X-Failed-Recipients, else addresses in the subject", () => {
    const a = msg("4", { From: "mailer-daemon@googlemail.com", "X-Failed-Recipients": "gone@acme.com", Subject: "Delivery Status Notification (Failure)" });
    expect(counterparts(a, "bounce", ME, INTERNAL)).toEqual(["gone@acme.com"]);
    const b = msg("5", { From: "postmaster@acme.com", Subject: "Undeliverable: mail to gone@acme.com" });
    expect(counterparts(b, "bounce", ME, INTERNAL)).toEqual(["gone@acme.com"]);
  });
  it("company domains come from members, never freemail", () => {
    expect(internalDomains(["a@foxroofing.co", "B@FoxRoofing.co", "rep@gmail.com", null])).toEqual(["foxroofing.co"]);
  });
});

describe("dedupe keys", () => {
  it("message id alone for one contact; message:contact when several match", () => {
    expect(dedupeKey("18c2", "c1", 1)).toBe("18c2");
    expect(dedupeKey("18c2", "c1", 2)).toBe("18c2:c1");
  });
});

describe("buildTouchRows", () => {
  const contacts = new Map<string, ContactMatch[]>([
    ["pm@acme.com", [{ id: "c-pm", email: "pm@acme.com" }]],
    ["owner@acme.com", [{ id: "c-owner", email: "owner@acme.com" }]],
    ["gone@acme.com", [{ id: "c-gone", email: "gone@acme.com" }]],
  ]);
  const opts = { userEmail: ME, internal: INTERNAL, contactsByEmail: contacts, followUpCutoff: T0 - 7 * 86_400_000 };

  it("one touch per matched contact with the right direction, outcome, subject-only notes and keys", () => {
    const msgs = [
      msg("m1", { From: ME, To: "pm@acme.com, owner@acme.com", Subject: "Roof bid" }, ["SENT"], T0),
      msg("m2", { From: "pm@acme.com", To: ME, Subject: "Re: Roof bid" }, ["INBOX"], T0 + 3_600_000),
      msg("m3", { From: "mailer-daemon@googlemail.com", "X-Failed-Recipients": "gone@acme.com", Subject: "Delivery Status Notification (Failure)" }, ["INBOX"], T0 + 1),
      msg("m4", { From: "stranger@nowhere.com", To: ME, Subject: "Cold pitch" }),
      msg("m5", { From: "deals@store.com", To: ME }, ["INBOX", "CATEGORY_PROMOTIONS"]),
    ];
    const { rows, stats } = buildTouchRows(msgs, opts);
    expect(stats).toMatchObject({ messages: 5, ignored: 1, unknown: 1, matched: 3, byKind: { sent: 1, reply: 1, bounce: 1 } });
    expect(rows.map((r) => [r.external_id, r.contact_id, r.direction, r.outcome, r.notes])).toEqual([
      ["m1:c-owner", "c-owner", "outbound", "sent", "Roof bid"],
      ["m1:c-pm", "c-pm", "outbound", "sent", "Roof bid"],
      ["m3", "c-gone", "inbound", "bounced", "Delivery Status Notification (Failure)"],
      ["m2", "c-pm", "inbound", "replied", "Re: Roof bid"],
    ]);
    // Newest per contact keeps the follow-up; the earlier send to pm is superseded by the reply.
    expect(rows.find((r) => r.external_id === "m1:c-pm")?.skip_follow_up).toBe(true);
    expect(rows.find((r) => r.external_id === "m2")?.skip_follow_up).toBe(false);
    expect(rows.find((r) => r.external_id === "m1:c-owner")?.skip_follow_up).toBe(false);
    // Never stores the unknown sender anywhere.
    expect(JSON.stringify(rows)).not.toContain("stranger");
  });

  it("backfilled mail older than the follow-up window logs without a task", () => {
    const old = msg("old", { From: "pm@acme.com", To: ME, Subject: "Old" }, ["INBOX"], T0 - 20 * 86_400_000);
    expect(buildTouchRows([old], opts).rows[0].skip_follow_up).toBe(true);
  });

  it("lookupAddresses collects only outside counterparts", () => {
    const msgs = [msg("a", { From: ME, To: "x@acme.com, tyler@foxroofing.co" }, ["SENT"]), msg("b", { From: "y@acme.com" }), msg("c", { From: "z@promo.com" }, ["CATEGORY_PROMOTIONS"])];
    expect(lookupAddresses(msgs, ME, INTERNAL).sort()).toEqual(["x@acme.com", "y@acme.com"]);
  });
});
