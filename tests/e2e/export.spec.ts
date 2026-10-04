/** CSV export: streamed, RLS-scoped, managers and up; filters follow the list. */
import { fxAccount, uniqueWord } from "./support/db";
import { as, expect, test } from "./support/ui";

test.describe("Tyler (manager)", () => {
  as("tyler");

  test("Export on Accounts downloads a CSV of the filtered list", async ({ page }) => {
    const w = uniqueWord();
    await fxAccount({ owner: "kayla", name: `${w} Export Partners` });
    await page.goto(`/app/accounts?scope=all&q=${w}`);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export", exact: true }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^fox-accounts-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await new Promise<string>((resolve, reject) => {
      dl.createReadStream().then((s) => {
        const chunks: Buffer[] = [];
        s.on("data", (c: Buffer) => chunks.push(c));
        s.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        s.on("error", reject);
      }, reject);
    });
    const lines = text.replace(/^﻿/, "").trim().split(/\r\n/);
    expect(lines[0]).toBe(
      "Name,Type,Tier,Status,Owner,Owner email,Phone,Website,Address,City,State,Zip,Onboarding,Preference,Preference reason,Last touch,Days since touch,Properties,Contacts,Open opportunities,Open value,Source,Created,Dilly id",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`${w} Export Partners`);
    expect(lines[1]).toContain("Kayla Smiley");
  });

  test("contacts, properties (with manager + badges), opportunities and own touches", async ({ request }) => {
    for (const [kind, head] of [
      ["contacts", "First name,Last name,Full name,Title,Role,Company"],
      ["properties", "Name,Address,City,State,Zip,Asset class,Roof system,Roof install year,Roof sq ft,Units,Warranty expires,Current manager,Current owner,Badges"],
      ["opportunities", "Name,Stage,Service line,Value"],
      ["touches", "Date,Time,Rep,Channel,Outcome"],
    ] as const) {
      const r = await request.get(`/app/export/${kind}?scope=all`);
      expect(r.status(), kind).toBe(200);
      expect(r.headers()["content-type"]).toContain("text/csv");
      const body = (await r.text()).replace(/^﻿/, "");
      expect(body.startsWith(head), kind).toBe(true);
      if (kind !== "touches") expect(body.split("\r\n").length, kind).toBeGreaterThan(3);
    }
    // Manager touch export = only his own touches.
    const t = (await (await request.get("/app/export/touches?from=2020-01-01")).text()).trim().split("\r\n").slice(1);
    for (const line of t) expect(line).toContain("Tyler Fox");
  });
});

test.describe("Colby (rep)", () => {
  as("colby");
  test("export is not available to reps", async ({ request, page }) => {
    expect((await request.get("/app/export/accounts?scope=all")).status()).toBe(404);
    await page.goto("/app/contacts");
    await expect(page.getByRole("link", { name: "Export", exact: true })).toHaveCount(0);
  });
});
