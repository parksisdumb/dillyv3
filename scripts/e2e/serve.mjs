// Builds and serves the app for E2E on :3100 — `next build && next start -p 3100` — from an isolated copy of the repo
// (E2E_APP_DIR, default /tmp/dilly-e2e-app) so the build never clobbers the .next folder of anyone running
// `next dev` in the working tree. Set E2E_BUILD_IN_PLACE=1 to build in the repo instead.
//
// Env comes from playwright.config.ts (NEXT_PUBLIC_SUPABASE_URL, keys, font mocks).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = process.env.E2E_PORT ?? "3100";
const inPlace = process.env.E2E_BUILD_IN_PLACE === "1";
const APP = inPlace ? ROOT : path.resolve(process.env.E2E_APP_DIR ?? "/tmp/dilly-e2e-app");

if (!inPlace) {
  fs.rmSync(path.join(APP, "src"), { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });
  // E2E harness files stay out of the app build (they aren't part of the app).
  const SKIP = new Set(["node_modules", ".next", ".git", "tests", "test-results", "playwright-report", "playwright.config.ts", "tsconfig.tsbuildinfo"]);
  for (const entry of fs.readdirSync(ROOT)) {
    if (SKIP.has(entry)) continue;
    fs.cpSync(path.join(ROOT, entry), path.join(APP, entry), {
      recursive: true,
      force: true,
      filter: (src) => !src.startsWith(path.join(ROOT, "scripts", "e2e")),
    });
  }
  const nm = path.join(APP, "node_modules");
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, "node_modules"), nm, "dir");

  // The e2e build is the strict production build (type errors fail it). E2E_TYPECHECK=0 skips type checking when
  // you need behavioural results from a tree with a half-finished type change.
  if (process.env.E2E_TYPECHECK === "0") {
    fs.renameSync(path.join(APP, "next.config.ts"), path.join(APP, "next.config.base.ts"));
    fs.writeFileSync(
      path.join(APP, "next.config.ts"),
      `import type { NextConfig } from "next";\nimport base from "./next.config.base";\n` +
        `const config: NextConfig = { ...base, typescript: { ...(base.typescript ?? {}), ignoreBuildErrors: true } };\nexport default config;\n`,
    );
  }
}

const next = path.join(ROOT, "node_modules", ".bin", "next");
if (process.env.E2E_SKIP_BUILD !== "1") {
  console.log(`[e2e] next build in ${APP}`);
  const b = spawnSync(next, ["build", "--no-lint"], { cwd: APP, stdio: "inherit", env: process.env });
  if (b.status !== 0) {
    console.error("[e2e] next build failed");
    process.exit(b.status ?? 1);
  }
}
console.log(`[e2e] next start -p ${PORT}`);
const s = spawn(next, ["start", "-p", PORT], { cwd: APP, stdio: "inherit", env: process.env });
const stop = () => s.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
s.on("exit", (code) => process.exit(code ?? 0));
