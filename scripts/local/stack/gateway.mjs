// Minimal stand-in for Supabase's Kong gateway: /auth/v1 → Auth, /rest/v1 → PostgREST.
import http from "node:http";
const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  ["/auth/v1", Number(process.env.AUTH_PORT ?? 9999)],
  ["/rest/v1", Number(process.env.REST_PORT ?? 3001)],
];
http
  .createServer((req, res) => {
    const hit = routes.find(([p]) => req.url.startsWith(p));
    if (!hit) { res.writeHead(404); return res.end("no route"); }
    const [prefix, port] = hit;
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const up = http.request({ host: "127.0.0.1", port, path: req.url.slice(prefix.length) || "/", method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  })
  .listen(PORT, () => console.log(`gateway on :${PORT}`));
