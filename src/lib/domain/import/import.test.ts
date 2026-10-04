import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applySavedMapping, detectMapping, detectPartyRole, guessField, headerSignature, mappingToSaved, type Mapping } from "./fields";
import { mapRow, mapRows, normalizeName, parseAccountType, parseNumber, parseRoofSystem, similarity, splitName } from "./rows";
import { accountPayload, contactPayload, liveEntities, planCounts, planImport, propertyPayload, resolveRep, setActions, type ExistingIndex, type PlanOptions } from "./plan";
import { csvCell, csvLine, parseSheet } from "./parse";

const byField = (headers: string[], m: Mapping) => Object.fromEntries(Object.entries(m).map(([i, f]) => [headers[Number(i)], f]));

describe("header detection", () => {
  it("maps the common flat property sheet", () => {
    const h = ["Management Company", "Property Name", "Address", "City", "State", "Zip", "Units", "Roof Type", "Roof Year", "Sq Ft", "First Name", "Last Name", "Title", "Email", "Phone", "Rep Email", "Notes"];
    expect(byField(h, detectMapping(h))).toEqual({
      "Management Company": "account_name",
      "Property Name": "property_name",
      Address: "address1",
      City: "city",
      State: "state",
      Zip: "zip",
      Units: "unit_count",
      "Roof Type": "roof_system",
      "Roof Year": "roof_year",
      "Sq Ft": "roof_area_sf",
      "First Name": "first_name",
      "Last Name": "last_name",
      Title: "title",
      Email: "email",
      Phone: "phone",
      "Rep Email": "rep_email",
      Notes: "notes",
    });
  });

  it("handles synonyms, punctuation and casing", () => {
    expect(guessField("E-mail Address")?.field).toBe("email");
    expect(guessField("COMMUNITY")?.field).toBe("property_name");
    expect(guessField("Bldg Owner")?.field).toBe("account_name");
    expect(guessField("Owner Email")?.field).toBe("rep_email");
    expect(guessField("Assigned Rep Email")?.field).toBe("rep_email");
    expect(guessField("Contact Email")?.field).toBe("email");
    expect(guessField("Cell #")?.field).toBe("mobile");
    expect(guessField("Roof Install Yr")?.field).toBe("roof_year");
    expect(guessField("Roof Age (yrs)")?.field).toBe("roof_age");
    expect(guessField("Roof SF")?.field).toBe("roof_area_sf");
    expect(guessField("# of Units")?.field).toBe("unit_count");
    expect(guessField("Zip Code")?.field).toBe("zip");
    expect(guessField("Full Name")?.field).toBe("full_name");
    expect(guessField("Favorite color")).toBeNull();
  });

  it("uses each field once and prefers first/last over a full name column", () => {
    const h = ["Name", "First", "Last", "Company", "Owner"];
    const m = byField(h, detectMapping(h));
    expect(m).toEqual({ First: "first_name", Last: "last_name", Company: "account_name" });
  });

  it("detects whether the company is the owner or the manager", () => {
    const a = ["Owner", "Address"];
    expect(detectPartyRole(a, detectMapping(a))).toBe("owner");
    const b = ["Management Company", "Address"];
    expect(detectPartyRole(b, detectMapping(b))).toBe("manager");
    const c = ["Company", "Address"];
    expect(detectPartyRole(c, detectMapping(c))).toBe("manager");
  });

  it("saved mappings round-trip by header text and ignore column order", () => {
    const h = ["Mgmt Co.", "Bldg", "Street"];
    const m: Mapping = { 0: "account_name", 1: "property_name", 2: "address1" };
    const saved = mappingToSaved(h, m);
    const reordered = ["Street", "Mgmt Co.", "Bldg"];
    expect(byField(reordered, applySavedMapping(reordered, saved))).toEqual({ Street: "address1", "Mgmt Co.": "account_name", Bldg: "property_name" });
    expect(headerSignature(h)).toBe(headerSignature(reordered));
  });
});

describe("row mapping and validation", () => {
  const h = ["Company", "Property", "Address", "City", "Contact", "Email", "Title", "Roof Age", "Sq Ft", "Tier", "Type"];
  const m = detectMapping(h);

  it("builds drafts with parsed numbers and normalized keys", () => {
    const r = mapRow(["Bluff City Residential, LLC", "Overton Flats", "1820 Madison Avenue", "Memphis", "Dana Whitfield", "DANA@example.com", "Regional Manager", "14", "42,500 sf", "P2", "PMC"], m, 0, 2026);
    expect(r.errors).toEqual([]);
    expect(r.account).toMatchObject({ name: "Bluff City Residential, LLC", norm: "bluff city residential", icp_tier: 2, account_type: "property_mgmt" });
    expect(r.contact).toMatchObject({ first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", title: "Regional Manager" });
    expect(r.property).toMatchObject({ name: "Overton Flats", norm: "1820 madison ave memphis", roof_install_year: 2012, roof_area_sf: 42500 });
  });

  it("flags bad emails and contacts with no name", () => {
    const bad = mapRow(["Acme", "", "", "", "Pat Lee", "pat@", "", "", "", "", ""], m, 3, 2026);
    expect(bad.errors.map((e) => e.field)).toEqual(["email"]);
    const noName = mapRow(["Acme", "", "", "", "", "", "Leasing", "", "", "", ""], m, 4, 2026);
    expect(noName.errors[0]?.message).toMatch(/no name or email/);
  });

  it("flags roof details with no property and empty rows", () => {
    const r = mapRow(["Acme", "", "", "", "", "", "", "12", "", "", ""], m, 5, 2026);
    expect(r.errors[0]?.message).toMatch(/no property/);
    expect(mapRow(Array(11).fill(""), m, 6, 2026).empty).toBe(true);
    const nothing = mapRow(["", "", "", "Memphis", "", "", "", "", "", "", ""], m, 7, 2026);
    expect(nothing.errors[0]?.message).toMatch(/Nothing to import/);
  });

  it("warns (doesn't fail) on unusable optional values", () => {
    const r = mapRow(["Acme", "Tower", "1 Main St", "Memphis", "", "", "", "old", "big", "gold", "space station"], m, 8, 2026);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.field).sort()).toEqual(["account_type", "roof_age", "roof_area_sf", "tier"]);
    expect(r.property?.roof_install_year).toBeNull();
  });

  it("parsers", () => {
    expect(parseNumber("1.2k")).toBe(1200);
    expect(parseNumber("n/a")).toBeNull();
    expect(parseRoofSystem("modified bitumen")).toBe("Mod-bit");
    expect(parseRoofSystem("TPO 60 mil")).toBe("TPO");
    expect(parseRoofSystem("Something new")).toBe("Something new");
    expect(parseAccountType("REIT")).toBe("reit");
    expect(parseAccountType("Property Mgmt")).toBe("property_mgmt");
    expect(splitName("Whitfield, Dana")).toEqual({ first: "Dana", last: "Whitfield" });
    expect(splitName("Dr. Dana M. Whitfield Jr.")).toEqual({ first: "Dana", last: "Whitfield" });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: null });
  });

  it("normalizeName mirrors app.normalize_name (suffixes, punctuation, inner spacing)", () => {
    expect(normalizeName("The Bluff City Co., Inc.")).toBe("bluff city");
    expect(normalizeName("Acme  LLC")).toBe("acme");
    expect(normalizeName("  ")).toBeNull();
    // SQL keeps the spaces left by a removed middle word; the port must too.
    expect(normalizeName("Smith Co Holdings")).toBe("smith   holdings");
  });

  it("similarity matches pg_trgm on simple names", () => {
    expect(similarity("Dana Whitfield", "Dana Whitfield")).toBe(1);
    expect(similarity("Dana Whitfield", "Dana Whitfeld")).toBeGreaterThan(0.6);
    expect(similarity("Dana Whitfield", "Marcus Okafor")).toBeLessThan(0.1);
    expect(similarity("", "x")).toBe(0);
  });
});

describe("dedupe planning", () => {
  const members = [
    { user_id: "u-kayla", email: "kayla@foxroofing.co", name: "Kayla Smiley" },
    { user_id: "u-colby", email: "colby@foxroofing.co", name: "Colby Remedios" },
  ];
  const opts: PlanOptions = { defaultOwnerId: "u-colby", members, defaultType: "property_mgmt", partyRole: "manager" };
  const existing: ExistingIndex = {
    accounts: [{ id: "a-1", name: "Bluff City Residential", normalized_name: "bluff city residential", owner_user_id: "u-kayla" }],
    contacts: [
      { id: "c-1", full_name: "Dana Whitfield", email: "dana@example.com", phone_digits: null, account_id: "a-1" },
      { id: "c-2", full_name: "Marcus Okafor", email: null, phone_digits: "9015550100 9015550199", account_id: null },
      { id: "c-3", full_name: "Priya Raman", email: null, phone_digits: null, account_id: "a-1" },
    ],
    properties: [{ id: "p-1", name: "Overton Flats", address1: "1820 Madison Ave", city: "Memphis", normalized_address: "1820 madison ave memphis", account_id: "a-1" }],
  };
  const h = ["Company", "Property", "Address", "City", "Contact", "Email", "Phone", "Rep Email"];
  const m = detectMapping(h);
  const sheet = [
    ["Bluff City Residential LLC", "Overton Flats", "1820 Madison Avenue", "Memphis", "Dana Whitfield", "dana@example.com", "", ""], // all matched
    ["Bluff City Residential", "Cooper Lofts", "455 S Cooper St", "Memphis", "Priya Ramen", "", "", ""], // new property, contact matched by name in company
    ["Riverbend Partners", "Harbor Town Commons", "300 Harbor Town Blvd", "Memphis", "Marcus Okafor", "", "(901) 555-0199", "kayla@foxroofing.co"], // contact by phone
    ["Riverbend Partners", "Harbor Town Commons", "300 Harbor Town Boulevard", "Memphis", "Marcus Okafor", "", "", ""], // repeat row
    ["Riverbend Partners", "Mud Island Annex", "12 Island Dr", "Memphis", "Jo Pruitt", "jo@example", "", "nobody@example.com"], // bad email → error
    ["", "", "", "", "", "", "", ""], // empty
    ["Cotton Row Holdings", "", "", "", "Leah Abernathy", "leah@example.com", "", "Colby Remedios"],
  ];
  const plan = planImport(mapRows(sheet, m, 2026), existing, opts);

  it("dedupes accounts against the tenant and within the sheet", () => {
    const names = plan.accounts.map((a) => [a.draft.name, a.action, a.match?.id ?? null]);
    expect(names).toEqual([
      ["Bluff City Residential LLC", "link", "a-1"],
      ["Riverbend Partners", "create", null],
      ["Cotton Row Holdings", "create", null],
    ]);
    expect(plan.accounts[0]!.rows).toEqual([0, 1]);
  });

  it("matches contacts by email, phone, and similar name in the same company", () => {
    const by = Object.fromEntries(plan.contacts.map((c) => [c.draft.full, c.match?.why ?? "new"]));
    expect(by).toEqual({
      "Dana Whitfield": "same email",
      "Priya Ramen": "similar name, same company",
      "Marcus Okafor": "same phone",
      "Jo Pruitt": "new",
      "Leah Abernathy": "new",
    });
  });

  it("does not match a similar name in a different company", () => {
    const p = planImport(mapRows([["Someone Else Inc", "", "", "", "Priya Raman", "", "", ""]], m, 2026), existing, opts);
    expect(p.contacts[0]!.match).toBeNull();
  });

  it("matches properties by normalized address; repeats collapse with a pointer to the first row", () => {
    expect(plan.properties.map((p) => [p.draft.name, p.match?.id ?? null, p.rows])).toEqual([
      ["Overton Flats", "p-1", [0]],
      ["Cooper Lofts", null, [1]],
      ["Harbor Town Commons", null, [2, 3]],
      ["Mud Island Annex", null, [4]],
    ]);
    expect(plan.rows[3]!.dupeOf).toBe(2);
    expect(plan.properties[2]!.contactKeys).toHaveLength(1);
  });

  it("assigns owners from the rep column (email or name), else the default rep, and warns on unknown reps", () => {
    const riverbend = plan.accounts.find((a) => a.draft.name === "Riverbend Partners")!;
    expect(riverbend.ownerId).toBe("u-kayla");
    expect(plan.accounts.find((a) => a.draft.name === "Cotton Row Holdings")!.ownerId).toBe("u-colby");
    expect(plan.rows[4]!.warnings.some((w) => w.field === "rep_email")).toBe(true);
    expect(resolveRep("KAYLA@foxroofing.co", members)?.user_id).toBe("u-kayla");
    expect(resolveRep("Colby Remedios", members)?.user_id).toBe("u-colby");
  });

  it("skips error and empty rows by default and counts new vs matched", () => {
    expect(plan.rows[4]!.skip).toBe(true);
    expect(plan.rows[5]!.empty).toBe(true);
    const c = planCounts(plan);
    expect(c.rows).toMatchObject({ total: 6, errors: 1, skipped: 1, empty: 1, repeats: 1, included: 5 });
    // Mud Island Annex only appears on the skipped row → not live.
    expect(c.properties).toEqual({ create: 2, link: 1, skip: 0, matched: 1 });
    expect(c.accounts).toEqual({ create: 2, link: 1, skip: 0, matched: 1 });
    expect(c.contacts).toEqual({ create: 1, link: 3, skip: 0, matched: 3 });
    expect(liveEntities(plan).contacts.map((x) => x.draft.full)).not.toContain("Jo Pruitt");
  });

  it("bulk overrides: matched → create new, new → skip; link never applies to new records", () => {
    const xs = setActions(plan.contacts, "matched", "create");
    expect(xs.filter((x) => x.match).every((x) => x.action === "create")).toBe(true);
    const ys = setActions(plan.contacts, "new", "link");
    expect(ys.filter((x) => !x.match).every((x) => x.action === "create")).toBe(true);
    const zs = setActions(plan.properties, "new", "skip");
    expect(zs.filter((x) => !x.match).every((x) => x.action === "skip")).toBe(true);
  });

  it("builds commit payloads that resolve keys to ids from earlier phases", () => {
    const acc = accountPayload(plan);
    expect(acc.map((a) => [a.action, a.id ?? null])).toEqual([
      ["link", "a-1"],
      ["create", null],
      ["create", null],
    ]);
    const ids = Object.fromEntries(acc.map((a, i) => [a.key, `A${i}`]));
    const con = contactPayload(plan, ids);
    expect(con.find((c) => c.first_name === "Marcus")).toMatchObject({ action: "link", id: "c-2", account_id: "A1" });
    const cids = Object.fromEntries(con.map((c, i) => [c.key, `C${i}`]));
    const props = propertyPayload(plan, ids, cids, "owner");
    expect(props.find((p) => p.name === "Harbor Town Commons")).toMatchObject({ action: "create", account_id: "A1", party_role: "owner", contact_ids: ["C2"] });
  });
});

describe("parsing & CSV output", () => {
  it("parses CSV with quotes and a BOM, and tab-separated pastes", () => {
    const s = parseSheet('﻿Company,Notes\r\n"Acme, Inc.","said ""hi""\nthen left"\r\n,\r\n');
    expect(s.headers).toEqual(["Company", "Notes"]);
    expect(s.rows).toEqual([["Acme, Inc.", 'said "hi"\nthen left']]);
    const t = parseSheet("Company\tCity\nAcme\tMemphis\n");
    expect(t.rows).toEqual([["Acme", "Memphis"]]);
  });

  it("escapes cells and neutralizes formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(["TPO", "Leak"])).toBe("TPO; Leak");
    expect(csvLine([1, null, "x"])).toBe("1,,x\r\n");
  });

  it("the TSG sample sheet maps fully and plans cleanly", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../../../docs/samples/tsg-import-sample.csv"), "utf8");
    const s = parseSheet(text);
    const m = detectMapping(s.headers);
    expect(Object.keys(m)).toHaveLength(s.headers.length);
    const plan = planImport(mapRows(s.rows, m, 2026), { accounts: [], contacts: [], properties: [] }, { defaultOwnerId: null, members: [], defaultType: "property_mgmt", partyRole: detectPartyRole(s.headers, m) });
    const c = planCounts(plan);
    expect(c.rows.total).toBeGreaterThanOrEqual(40);
    expect(c.rows.errors).toBeGreaterThan(0); // the sample carries a couple of bad rows on purpose
    expect(c.rows.repeats).toBeGreaterThan(0);
    expect(c.accounts.create).toBeGreaterThanOrEqual(8);
  });
});
