import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token encryption at rest: AES-256-GCM, random 12-byte IV, 16-byte tag.
 * Envelope: 'v1:' + base64(iv | tag | ciphertext). The DB refuses anything not starting with 'v1:'.
 * The tenant/user/connection id is bound as additional authenticated data, so a ciphertext copied onto another
 * row fails to decrypt.
 */
const VERSION = "v1:";

export function encryptSecret(plain: string, key: Buffer, aad = ""): string {
  if (key.length !== 32) throw new Error("MAIL_TOKEN_KEY must be 32 bytes");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return VERSION + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(envelope: string, key: Buffer, aad = ""): string {
  if (!envelope.startsWith(VERSION)) throw new Error("unknown token envelope");
  const buf = Buffer.from(envelope.slice(VERSION.length), "base64");
  if (buf.length < 29) throw new Error("token envelope too short");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  if (aad) d.setAAD(Buffer.from(aad, "utf8"));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------------------------------------------
// OAuth state: a short-lived HMAC-signed token carrying user + tenant + nonce. Also set as an httpOnly cookie;
// the callback requires both to match (CSRF / login-swap protection).

export type OAuthState = { u: string; t: string; n: string; exp: number };

/** Separate key per purpose, derived from MAIL_TOKEN_KEY. */
function stateKey(key: Buffer): Buffer {
  return createHmac("sha256", key).update("dilly/mail/oauth-state/v1").digest();
}

const b64url = (b: Buffer) => b.toString("base64url");

export function signState(s: Omit<OAuthState, "n" | "exp"> & { n?: string; exp?: number }, key: Buffer, now = Date.now(), ttlMs = 10 * 60_000): string {
  const payload: OAuthState = { u: s.u, t: s.t, n: s.n ?? b64url(randomBytes(16)), exp: s.exp ?? now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", stateKey(key)).update(body).digest());
  return `${body}.${sig}`;
}

export type StateCheck = { ok: true; state: OAuthState } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyState(token: string | null | undefined, key: Buffer, now = Date.now()): StateCheck {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const want = createHmac("sha256", stateKey(key)).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  let st: OAuthState;
  try {
    st = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof st?.u !== "string" || typeof st?.t !== "string" || typeof st?.n !== "string" || typeof st?.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (st.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, state: st };
}

/** Constant-time string equality (state param vs cookie). */
export function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
