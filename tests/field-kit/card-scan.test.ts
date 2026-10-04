import { describe, expect, it } from "vitest";
import { scanCard, CARD_MESSAGES } from "@/agents/card-scan";
import { cardNotes, cardSchema, formatPhone, normalizeCard, normalizeCompany } from "@/lib/cards/card";
import { fakeTransport, memoryStore, MODEL_ENV, nullDb } from "../agents/fixtures";

const input = { tenantId: "t1", userId: "u1", image: { data: "QUJD", mediaType: "image/jpeg" as const } };

describe("card JSON validation + cleanup", () => {
  it("accepts nulls/missing fields, rejects wrong types", () => {
    expect(cardSchema.safeParse({ first_name: "Dave" }).success).toBe(true);
    expect(cardSchema.safeParse({ first_name: null, email: null }).success).toBe(true);
    expect(cardSchema.safeParse({ first_name: 42 }).success).toBe(false);
  });
  it("normalizes what the model returns", () => {
    const c = normalizeCard({
      first_name: "  Dave  Morales ",
      last_name: null,
      title: "Regional Facilities Director",
      company: "Greystar Real Estate Partners, LLC",
      email: "MAILTO:Dave.Morales@Greystar.com",
      phone: "+1 512.555.0134",
      mobile: "512-555-0134",
      website: "https://www.greystar.com/",
      address: "N/A",
    });
    expect(c).toMatchObject({
      first_name: "Dave",
      last_name: "Morales",
      full_name: "Dave Morales",
      email: "dave.morales@greystar.com",
      phone: "(512) 555-0134",
      mobile: null, // same number as phone
      website: "www.greystar.com",
      address: null,
    });
    expect(normalizeCard({ email: "not an email" }).email).toBeNull();
    expect(normalizeCard({ mobile: "(214) 555 0199" })).toMatchObject({ phone: "(214) 555-0199", mobile: null });
  });
  it("phones: US formatted; extensions/international kept as printed; junk dropped", () => {
    expect(formatPhone("5125550134")).toBe("(512) 555-0134");
    expect(formatPhone("512-555-0134 ext 22")).toBe("512-555-0134 ext 22");
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("call me")).toBeNull();
  });
  it("company names normalize like app.normalize_name()", () => {
    expect(normalizeCompany("Greystar Real Estate Partners, LLC")).toBe("greystar real estate partners");
    expect(normalizeCompany("The Lincoln Property Co.")).toBe("lincoln property");
    expect(normalizeCompany("  ")).toBeNull();
  });
  it("website/address become a notes line", () => {
    expect(cardNotes(normalizeCard({ website: "acme.com", address: "1 Main St, Austin, TX" }))).toBe("From business card — Web: acme.com · Address: 1 Main St, Austin, TX");
    expect(cardNotes(normalizeCard({}))).toBeNull();
  });
});

describe("scanCard (fake LLM transport)", () => {
  it("reads a card: vision request on the sonnet tier, validated + cleaned fields, one agent_run with cost", async () => {
    const { transport, requests } = fakeTransport(['{"is_business_card":true,"first_name":"Rachel","last_name":"Ibarra","title":"Director of Facilities","company":"Sunbelt Medical","email":"RIBARRA@SUNBELTMED.COM","phone":"5125550188","mobile":null,"website":null,"address":null}']);
    const s = memoryStore();
    const r = await scanCard(input, { transport, env: MODEL_ENV, store: s.store, db: nullDb });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields).toMatchObject({ full_name: "Rachel Ibarra", email: "ribarra@sunbeltmed.com", phone: "(512) 555-0188", company: "Sunbelt Medical" });
    expect(requests[0].model).toBe("test-sonnet");
    const content = requests[0].messages[0].content;
    expect(Array.isArray(content) && content[0]).toMatchObject({ type: "image", mediaType: "image/jpeg", data: "QUJD" });
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]).toMatchObject({ agentKey: "card-scan", trigger: "human", subjectUserId: "u1" });
    expect(s.runs[0].finish?.status).toBe("succeeded");
    expect(s.runs[0].finish?.costUsd).toBeGreaterThan(0);
    expect(s.steps[0]).toMatchObject({ name: "read-card", tier: "sonnet", model: "test-sonnet" });
  });

  it("retries once on invalid JSON, then falls back to 'unreadable' (never throws)", async () => {
    const { transport, requests } = fakeTransport(['{"first_name": 42}', "sorry, I can't"]);
    const s = memoryStore();
    const r = await scanCard(input, { transport, env: MODEL_ENV, store: s.store, db: nullDb });
    expect(requests).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, reason: "unreadable", message: CARD_MESSAGES.unreadable });
    expect(s.runs[0].finish?.status).toBe("failed");
  });

  it("not a card / nothing usable → unreadable", async () => {
    const { transport } = fakeTransport(['{"is_business_card":false}']);
    expect(await scanCard(input, { transport, env: MODEL_ENV, store: memoryStore().store, db: nullDb })).toMatchObject({ ok: false, reason: "unreadable" });
    const empty = fakeTransport(['{"is_business_card":true,"title":"Manager"}']);
    expect(await scanCard(input, { transport: empty.transport, env: MODEL_ENV, store: memoryStore().store, db: nullDb })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("no API key or no model id → not_configured, still logged as a run, no LLM call", async () => {
    const s = memoryStore();
    const r = await scanCard(input, { transport: null, env: MODEL_ENV, store: s.store, db: nullDb });
    expect(r).toMatchObject({ ok: false, reason: "not_configured", message: CARD_MESSAGES.not_configured });
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0].finish?.costUsd).toBe(0);
    const { transport, requests } = fakeTransport(["{}"]);
    expect(await scanCard(input, { transport, env: {}, store: memoryStore().store, db: nullDb })).toMatchObject({ reason: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  it("transport failure (timeout / outage) → failed with a type-it-in message", async () => {
    const transport = async () => {
      throw new Error("timeout");
    };
    expect(await scanCard(input, { transport, env: MODEL_ENV, store: memoryStore().store, db: nullDb })).toMatchObject({ ok: false, reason: "failed", message: CARD_MESSAGES.failed });
  });

  it("works even when the run log can't be written", async () => {
    const { transport } = fakeTransport(['{"first_name":"Al","last_name":"Ng","email":"al@x.co"}']);
    const broken = {
      createRun: async () => {
        throw new Error("no service role");
      },
      addStep: async () => {},
      finishRun: async () => {},
    };
    const r = await scanCard(input, { transport, env: MODEL_ENV, store: broken, db: nullDb });
    expect(r).toMatchObject({ ok: true, runId: null, fields: { full_name: "Al Ng", email: "al@x.co" } });
  });
});
