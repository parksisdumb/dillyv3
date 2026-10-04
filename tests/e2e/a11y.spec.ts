/**
 * Accessibility smoke on every main screen: one h1, every button/link has an accessible name, no sideways scroll at
 * phone width, and primary tap targets ≥ 44×44 px. Known app bugs are listed in KNOWN (see BUGS.md) and run as fixme.
 */
import type { Page } from "@playwright/test";
import type { PersonaKey } from "../../scripts/e2e/seed";
import { db } from "./support/db";
import { authFile } from "./support/personas";
import { expect, test } from "./support/ui";

type Screen = { key: string; who: PersonaKey | null; path: () => Promise<string> };
const fixed = (p: string) => async () => p;
const byName = (table: "account" | "contact", col: string, val: string, base: string) => async () => {
  const { data } = await db.from(table).select("id").eq(col, val).limit(1).single();
  return `${base}/${data!.id}`;
};

const SCREENS: Screen[] = [
  { key: "login", who: null, path: fixed("/login") },
  { key: "today", who: "colby", path: fixed("/app/today") },
  { key: "go", who: "colby", path: fixed("/app/go?city=Austin") },
  { key: "go-focus", who: "colby", path: fixed("/app/go?mode=focus") },
  { key: "accounts", who: "colby", path: fixed("/app/accounts") },
  { key: "account-detail", who: "colby", path: byName("account", "name", "Greystar", "/app/accounts") },
  { key: "contacts", who: "colby", path: fixed("/app/contacts") },
  { key: "contact-detail", who: "colby", path: byName("contact", "full_name", "Dana Whitfield", "/app/contacts") },
  { key: "properties", who: "colby", path: fixed("/app/properties") },
  { key: "pipeline", who: "colby", path: fixed("/app/pipeline") },
  { key: "me", who: "colby", path: fixed("/app/me") },
  { key: "settings", who: "colby", path: fixed("/app/settings") },
  { key: "team", who: "tyler", path: fixed("/app/team") },
  { key: "team-pace", who: "tyler", path: fixed("/app/team/pace") },
  { key: "approvals", who: "tyler", path: fixed("/app/approvals") },
];

/** `${screen}:${check}` → BUGS.md anchor. */
const KNOWN: Record<string, string> = {
  "today:exactly one h1": "BUGS.md#b5",
  "accounts:exactly one h1": "BUGS.md#b5",
  "contacts:exactly one h1": "BUGS.md#b5",
  "properties:exactly one h1": "BUGS.md#b5",
};

async function open(page: Page, s: Screen) {
  const res = await page.goto(await s.path());
  expect(res?.ok(), `${s.key} should load`).toBe(true);
  await page.waitForLoadState("networkidle").catch(() => {});
}

for (const s of SCREENS) {
  test.describe(`a11y: ${s.key}`, () => {
    if (s.who) test.use({ storageState: authFile(s.who) });

    const check = (name: string, fn: (page: Page) => Promise<void>) => {
      const bug = KNOWN[`${s.key}:${name}`];
      if (bug) test.fixme(`${name} — known bug ${bug}`, async ({ page }) => fn(page));
      else test(name, async ({ page }) => fn(page));
    };

    check("exactly one h1", async (page) => {
      await open(page, s);
      const h1s = await page.locator("h1").allTextContents();
      expect(h1s, `h1s on ${s.key}: ${JSON.stringify(h1s)}`).toHaveLength(1);
    });

    check("buttons and links have accessible names", async (page) => {
      await open(page, s);
      const unnamed = await page.locator("button:visible, a[href]:visible, [role=button]:visible").evaluateAll((els) =>
        els
          .filter((el) => {
            const label = el.getAttribute("aria-label")?.trim();
            const by = el.getAttribute("aria-labelledby");
            const byText = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join("").trim() : "";
            const text = (el as HTMLElement).innerText?.trim();
            const title = el.getAttribute("title")?.trim();
            const alt = [...el.querySelectorAll("img[alt]")].map((i) => i.getAttribute("alt")).join("").trim();
            return !(label || byText || text || title || alt);
          })
          .map((el) => el.outerHTML.slice(0, 160)),
      );
      expect(unnamed, `unnamed controls on ${s.key}`).toEqual([]);
    });

    check("no horizontal overflow", async (page) => {
      await open(page, s);
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `${s.key}: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw + 1);
    });

    check("primary tap targets are at least 44×44", async (page) => {
      await open(page, s);
      const small = await page
        .locator(
          [
            "nav[aria-label=Main] a",
            "button[aria-label='Log a touch']",
            "header button",
            "header a[href]",
            "main button:visible",
            "main [role=tab]",
            "main select",
            "main input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
          ].join(", "),
        )
        .evaluateAll((els) =>
          els
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.height < 44 || r.width < 44))
            .map(({ el, r }) => `${Math.round(r.width)}×${Math.round(r.height)} ${((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40)}`),
        );
      expect(small, `small tap targets on ${s.key}`).toEqual([]);
    });
  });
}
