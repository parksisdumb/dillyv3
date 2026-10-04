/**
 * Visual capture for human review: one full-page screenshot per main screen per project, written to
 * test-results/e2e/screens/<project>/<screen>.png (and attached to the HTML report). No pixel diffing — the data
 * changes every run.
 */
import fs from "node:fs";
import path from "node:path";
import type { PersonaKey } from "../../scripts/e2e/seed";
import { db } from "./support/db";
import { authFile } from "./support/personas";
import { expect, test } from "./support/ui";

const id = async (table: "account" | "contact" | "opportunity", col: string, val: string) =>
  (await db.from(table).select("id").eq(col, val).limit(1).single()).data!.id as string;

const propId = async (name: string) => (await db.from("property").select("id").eq("name", name).limit(1).single()).data!.id as string;

const SHOTS: { key: string; who: PersonaKey | null; path: () => Promise<string>; open?: "log" | "transfer" }[] = [
  { key: "01-login", who: null, path: async () => "/login" },
  { key: "02-today", who: "colby", path: async () => "/app/today" },
  { key: "03-today-brief", who: "kayla", path: async () => "/app/today" },
  { key: "04-log-sheet", who: "colby", path: async () => "/app/today", open: "log" },
  { key: "05-go-field", who: "colby", path: async () => "/app/go?city=Austin" },
  { key: "06-go-focus", who: "colby", path: async () => "/app/go?mode=focus" },
  { key: "07-accounts", who: "colby", path: async () => "/app/accounts" },
  { key: "08-account-detail", who: "colby", path: async () => `/app/accounts/${await id("account", "name", "Greystar")}` },
  { key: "09-contacts", who: "colby", path: async () => "/app/contacts" },
  { key: "10-contact-detail", who: "colby", path: async () => `/app/contacts/${await id("contact", "full_name", "Dana Whitfield")}` },
  { key: "11-properties", who: "colby", path: async () => "/app/properties" },
  { key: "12-pipeline", who: "colby", path: async () => "/app/pipeline" },
  { key: "13-opportunity", who: "colby", path: async () => `/app/pipeline/${await id("opportunity", "name", "Lincoln — Preston Hollow Bldg 4 TPO re-roof")}` },
  { key: "14-me", who: "colby", path: async () => "/app/me" },
  { key: "15-settings-manager", who: "tyler", path: async () => "/app/settings" },
  { key: "16-team", who: "tyler", path: async () => "/app/team" },
  { key: "17-team-pace", who: "tyler", path: async () => "/app/team/pace" },
  { key: "18-team-stalled", who: "tyler", path: async () => "/app/team/stalled" },
  { key: "19-team-activity", who: "tyler", path: async () => "/app/team/activity" },
  { key: "20-approvals", who: "tyler", path: async () => "/app/approvals" },
  { key: "21-tsg-today", who: "tsgrep", path: async () => "/app/today" },
  { key: "22-property-detail", who: "colby", path: async () => `/app/properties/${await propId("The Monroe")}` },
  { key: "23-transfer-sheet", who: "colby", path: async () => `/app/properties/${await propId("The Monroe")}`, open: "transfer" },
];

for (const s of SHOTS) {
  test.describe(`screen ${s.key}`, () => {
    if (s.who) test.use({ storageState: authFile(s.who) });
    test(`capture ${s.key}`, async ({ page }, info) => {
      const res = await page.goto(await s.path());
      expect(res?.ok()).toBe(true);
      await page.waitForLoadState("networkidle").catch(() => {});
      if (s.open === "log") {
        await page.getByRole("button", { name: "Log a touch" }).click();
        await expect(page.locator("dialog[open]")).toBeVisible();
        await page.waitForTimeout(500);
      }
      if (s.open === "transfer") {
        await page.getByRole("button", { name: "Change management" }).click();
        await expect(page.locator("dialog[open]")).toBeVisible();
        await page.waitForTimeout(500);
      }
      await page.evaluate(() => document.fonts.ready);
      const dir = path.join("test-results/e2e/screens", info.project.name);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${s.key}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      await info.attach(s.key, { path: file, contentType: "image/png" });
    });
  });
}
