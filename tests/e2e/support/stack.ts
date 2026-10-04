import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LOG = process.env.STACK_LOG ?? "/tmp/dilly-stack";
const ROOT = path.resolve(__dirname, "../../..");
const GATEWAY = "http://127.0.0.1:54321";
const PROXY = "http://127.0.0.1:54331";

async function up(): Promise<boolean> {
  try {
    return (await fetch(`${GATEWAY}/auth/v1/health`)).ok;
  } catch {
    return false;
  }
}

/** Kill the stack gateway (:54321) via its pid file — Auth + PostgREST become unreachable. */
export async function stopGateway() {
  const file = path.join(LOG, "gateway.pid");
  const fromFile = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8").trim().split(/\s+/)[0]) : NaN;
  const pids = new Set<number>(Number.isFinite(fromFile) ? [fromFile] : []);
  // The pid file can be stale when someone else restarted the stack: also match the process by command line.
  try {
    for (const p of execFileSync("pgrep", ["-f", "scripts/local/stack/gateway.mjs"], { encoding: "utf8" }).split(/\s+/)) if (p) pids.add(Number(p));
  } catch {
    /* none */
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 40 && (await up()); i++) await new Promise((r) => setTimeout(r, 100));
  if (await up()) throw new Error("gateway still answering after kill");
}

/** Restart the gateway the same way scripts/local/stack/up.sh does and rewrite the pid file. */
export async function startGateway() {
  if (await up()) return;
  const out = fs.openSync(path.join(LOG, "gateway.log"), "a");
  const child = spawn(process.execPath, [path.join(ROOT, "scripts/local/stack/gateway.mjs")], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  fs.writeFileSync(path.join(LOG, "gateway.pid"), String(child.pid));
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await up())) throw new Error("gateway did not come back");
}

/** Server-side Supabase latency via scripts/e2e/latency-proxy.mjs. */
export async function setServerDelay(ms: number, prefix = "/rest/v1") {
  const r = await fetch(`${PROXY}/__e2e/delay?ms=${ms}&prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error("latency proxy not reachable (is the app pointed at it? E2E_DIRECT must be unset)");
}
