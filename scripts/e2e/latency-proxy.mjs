// E2E-only pass-through in front of the local stack gateway (:54321) so tests can make the *server-side* Supabase
// link slow or broken. The app talks to Supabase only from the server (server components + server actions), so
// Playwright's page.route() cannot delay those calls — this proxy can.
//
//   node scripts/e2e/latency-proxy.mjs            # listens on :54331 → 127.0.0.1:54321
//   curl 'http://127.0.0.1:54331/__e2e/delay?ms=3000&prefix=/rest/v1'   # delay matching requests
//   curl 'http://127.0.0.1:54331/__e2e/delay?ms=0'                       # back to normal
//
// When the upstream gateway is down the client socket is destroyed (the app sees a network failure, like a
// refused connection), not a synthetic 502.
import http from "node:http";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 54331);
const UP_HOST = process.env.E2E_UPSTREAM_HOST ?? "127.0.0.1";
const UP_PORT = Number(process.env.E2E_UPSTREAM_PORT ?? 54321);
let delayMs = 0;
let prefix = "/rest/v1";

http
  .createServer((req, res) => {
    if (req.url?.startsWith("/__e2e/delay")) {
      const u = new URL(req.url, "http://x");
      delayMs = Number(u.searchParams.get("ms") ?? 0) || 0;
      prefix = u.searchParams.get("prefix") ?? "/rest/v1";
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ delayMs, prefix }));
    }
    if (req.url === "/__e2e/health") {
      res.writeHead(200);
      return res.end("ok");
    }
    const go = () => {
      const up = http.request(
        { host: UP_HOST, port: UP_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `${UP_HOST}:${UP_PORT}` } },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => req.socket.destroy());
      req.pipe(up);
    };
    const wait = delayMs > 0 && req.url?.startsWith(prefix) ? delayMs : 0;
    if (wait) {
      req.pause();
      setTimeout(() => {
        req.resume();
        go();
      }, wait);
    } else go();
  })
  .listen(PORT, "127.0.0.1", () => console.log(`e2e latency proxy :${PORT} → ${UP_HOST}:${UP_PORT}`));
