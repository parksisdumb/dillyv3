import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import { ANON_KEY, SERVICE_KEY } from "./scripts/local/stack/keys.mjs";

/**
 * Dilly end-to-end suite — runs against the REAL local Supabase-equivalent stack (scripts/local/stack: GoTrue +
 * PostgREST + gateway on :54321, Postgres db dilly_e2e). See tests/e2e/README.md.
 *
 * The app reaches Supabase through scripts/e2e/latency-proxy.mjs (:54331 → :54321) so tests can slow down or break
 * the server-side Supabase link; set E2E_DIRECT=1 to point the app straight at the gateway.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const PROXY_PORT = 54331;
const SUPABASE_URL = process.env.E2E_DIRECT === "1" ? "http://127.0.0.1:54321" : `http://127.0.0.1:${PROXY_PORT}`;
const CHROME = process.env.E2E_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/pw-browsers";

const appEnv: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  NEXT_PUBLIC_APP_URL: BASE_URL,
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES:
    process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES ?? "/tmp/claude-0/-home-claude/c1db14ea-f28c-5a16-97bd-bb8911c2d8b7/scratchpad/font-mocks.json",
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "/root",
  NEXT_TELEMETRY_DISABLED: "1",
  STORAGE_DRIVER: "local", // the e2e stack has no Storage API: photos/card scans go to disk, served by /api/media/file
  // E2E-only Web Push keys (never used outside the local suite): Settings → Notifications renders its real states.
  VAPID_PUBLIC_KEY: "BBw7Uu3mITizQtb2DXMheM4JFHUkVLCq1FXzQmO7aG7xFJHLwkK9-nIukQKwPLoMoYWh2tg1G0YOozouOGWvRr8",
  VAPID_PRIVATE_KEY: "3q1A2vIfoor5UtMxSc5c2y1zQKBL0XLFqpNHAorPhrg",
  VAPID_SUBJECT: "mailto:team@dillyos.com",
};

const mobile = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const desktop = { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

// Specs that make sense on the desktop (manager screens + cross-cutting checks). Everything runs on mobile.
const DESKTOP_SPECS = /(team|a11y|visual|scorecard)\.spec\.ts$/;

const config: PlaywrightTestConfig = {
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 }, // post-action router refreshes can take several seconds under 3 parallel workers
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/e2e-report", open: "never" }], ["json", { outputFile: "test-results/e2e-results.json" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: { executablePath: CHROME },
    locale: "en-US",
    timezoneId: "America/Chicago",
    // The production build registers /sw.js; keep it out of the way of page.route and network assertions.
    // tests/e2e/pwa.spec.ts opts back in for the offline-fallback check.
    serviceWorkers: "block",
  },
  projects: [
    { name: "mobile", use: mobile, testIgnore: /resilience\.spec\.ts$/ },
    { name: "desktop", use: desktop, testMatch: DESKTOP_SPECS },
    // Stops and restarts the stack gateway: runs alone, after everything else.
    { name: "resilience", use: mobile, testMatch: /resilience\.spec\.ts$/, dependencies: ["mobile", "desktop"] },
  ],
  webServer: [
    {
      command: "node scripts/e2e/latency-proxy.mjs",
      url: `http://127.0.0.1:${PROXY_PORT}/__e2e/health`,
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      // next build && next start -p 3100, from an isolated copy of the repo (see scripts/e2e/serve.mjs).
      command: "node scripts/e2e/serve.mjs",
      url: `${BASE_URL}/login`,
      env: { ...appEnv, E2E_PORT: String(PORT) },
      reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
      timeout: 600_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
};

export default defineConfig(config);
