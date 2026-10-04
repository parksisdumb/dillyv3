import { chromium, type FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { seed, PERSONAS, E2E_PASSWORD, STACK_URL, type PersonaKey } from "../../scripts/e2e/seed";
import { AUTH_DIR, authFile } from "./support/personas";

const ROOT = path.resolve(__dirname, "../..");

async function healthy(): Promise<boolean> {
  try {
    const [auth, rest] = await Promise.all([fetch(`${STACK_URL}/auth/v1/health`), fetch(`${STACK_URL}/rest/v1/`)]);
    return auth.ok && rest.status < 500;
  } catch {
    return false;
  }
}

/** Stack up check: if the gateway/auth/PostgREST aren't answering, try scripts/local/stack/up.sh (needs STACK_BIN). */
async function ensureStack() {
  if (await healthy()) return;
  const bin = stackBin();
  if (!bin) {
    throw new Error(
      `Local Supabase stack is not answering at ${STACK_URL}. Start it with:\n` +
        `  STACK_BIN=<dir with auth + postgrest> ./scripts/local/stack/up.sh   (add --fresh to rebuild dilly_e2e)\n` +
        `Postgres must be running on :54329 (see scripts/local/stack/README.md).`,
    );
  }
  console.log("[e2e] stack down — running scripts/local/stack/up.sh");
  execFileSync(path.join(ROOT, "scripts/local/stack/up.sh"), [], { stdio: "inherit", env: { ...process.env, STACK_BIN: bin } });
  for (let i = 0; i < 20 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await healthy())) throw new Error("Local Supabase stack did not come up.");
}

/** Log in through the real /login UI once per persona and save the storage state. */
async function loginAll(baseURL: string, executablePath?: string) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath });
  try {
    for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(PERSONAS[key].email);
      await page.getByLabel("Password").fill(E2E_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/app/today", { timeout: 60_000 });
      await ctx.storageState({ path: authFile(key) });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

/**
 * The app is moving fast: when supabase/migrations changes, dilly_e2e must be rebuilt or the app queries columns that
 * don't exist. We remember the migrations' hash from the last fresh build and run `up.sh --fresh` when it differs
 * (or always with E2E_FRESH=1). E2E_FRESH=0 skips the check.
 */
function migrationsHash(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  const h = createHash("sha256");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  return h.digest("hex");
}

/**
 * up.sh --fresh drops dilly_e2e, which fails while anything is connected. Its own pid-file cleanup can miss services
 * started by someone else, so stop the stack processes by command line and terminate leftover backends first.
 */
function releaseDatabase() {
  for (const pattern of ["auth serve", "postgrest.conf", "scripts/local/stack/gateway.mjs"]) {
    try {
      execFileSync("pkill", ["-f", pattern]);
    } catch {
      /* nothing running */
    }
  }
  try {
    execFileSync("psql", [
      "postgresql://postgres@localhost:54329/postgres?host=/tmp",
      "-qAtc",
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'dilly_e2e' and pid <> pg_backend_pid()",
    ]);
  } catch (e) {
    console.warn("[e2e] could not terminate dilly_e2e sessions:", (e as Error).message);
  }
}

function stackBin(): string | undefined {
  if (process.env.STACK_BIN) return process.env.STACK_BIN;
  const home = path.join(process.env.HOME ?? "/root", ".dilly-stack");
  return fs.existsSync(path.join(home, "auth")) ? home : undefined;
}

async function ensureFreshSchema() {
  if (process.env.E2E_FRESH === "0") return;
  const marker = path.join(process.env.STACK_LOG ?? "/tmp/dilly-stack", "e2e-migrations.sha256");
  const want = migrationsHash();
  const have = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  if (want === have && process.env.E2E_FRESH !== "1") return;
  const bin = stackBin();
  if (!bin) {
    console.warn("[e2e] supabase/migrations changed since dilly_e2e was built, but STACK_BIN is not set — skipping rebuild.");
    return;
  }
  console.log("[e2e] migrations changed → scripts/local/stack/up.sh --fresh");
  releaseDatabase();
  execFileSync(path.join(ROOT, "scripts/local/stack/up.sh"), ["--fresh"], { stdio: "inherit", env: { ...process.env, STACK_BIN: bin } });
  for (let i = 0; i < 20 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(marker, want);
}

export default async function globalSetup(config: FullConfig) {
  await ensureStack();
  await ensureFreshSchema();
  if (process.env.E2E_SKIP_SEED !== "1") await seed((m) => console.log(`[e2e] ${m}`));
  const use = config.projects[0]?.use ?? {};
  const baseURL = use.baseURL ?? "http://localhost:3100";
  await loginAll(baseURL, use.launchOptions?.executablePath);
}
