// Prints anon + service_role JWTs for the local stack (HS256, shared secret with Auth + PostgREST).
import crypto from "node:crypto";
export const JWT_SECRET = process.env.STACK_JWT_SECRET ?? "dilly-local-stack-jwt-secret-at-least-32-chars";
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64(payload);
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
export const ANON_KEY = sign({ role: "anon", iss: "supabase-local", exp });
export const SERVICE_KEY = sign({ role: "service_role", iss: "supabase-local", exp });
if (process.argv[1]?.endsWith("keys.mjs")) {
  console.log(`ANON_KEY=${ANON_KEY}\nSERVICE_KEY=${SERVICE_KEY}`);
}
