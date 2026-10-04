import { expect, test as base, type Locator, type Page } from "@playwright/test";
import type { PersonaKey } from "../../../scripts/e2e/seed";
import { authFile } from "./personas";

export { expect };
export const test = base;

/** Use a persona's saved session for every test in the current describe/file. */
export function as(p: PersonaKey) {
  test.use({ storageState: authFile(p) });
}

/** The toast stack (aria-live region; loading skeletons are also role=status but carry aria-busy). */
export const toasts = (page: Page) => page.locator('[role="status"][aria-live="polite"]:not([aria-busy])').last();

/** Inline form errors (Next's route announcer is also role=alert, so scope to the app's <p role=alert>). */
export const formAlert = (scope: Page | Locator) => scope.locator("p[role=alert]");

/** The open bottom sheet (<dialog>). */
export const sheet = (page: Page) => page.locator("dialog[open]");

/** A Today queue row by its (unique) title. */
export const queueRow = (page: Page, title: string) => page.locator("main li").filter({ has: page.getByText(title, { exact: true }) });

/** Mobile-first tap; falls back to click on non-touch projects. */
export async function tap(page: Page, l: Locator) {
  const touch = test.info().project.use.hasTouch;
  if (touch) await l.tap();
  else await l.click();
}

/** Server actions return before the router refresh re-renders; wait for the network to calm down. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Outcome/channel tiles render "Label" + "+N" (or "In person"): match on the leading label. */
export const tile = (scope: Page | Locator, label: string) => scope.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });

/** Save a screenshot for BUGS.md evidence (kept outside test-results, which is wiped each run). */
export async function evidence(page: Page, name: string) {
  await page.screenshot({ path: `tests/e2e/bug-shots/${name}.png`, fullPage: true }).catch(() => {});
}
