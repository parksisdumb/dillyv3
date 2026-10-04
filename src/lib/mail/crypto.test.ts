import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, sameToken, signState, verifyState } from "./crypto";

const key = randomBytes(32);

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips and never contains the plaintext", () => {
    const token = "1//0gExampleRefreshToken-abc_DEF";
    const enc = encryptSecret(token, key, "t:u:google");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(token);
    expect(decryptSecret(enc, key, "t:u:google")).toBe(token);
    expect(encryptSecret(token, key)).not.toBe(encryptSecret(token, key)); // random IV
  });
  it("fails with the wrong key, wrong AAD (copied to another row) or a tampered ciphertext", () => {
    const enc = encryptSecret("secret", key, "t:u:google");
    expect(() => decryptSecret(enc, randomBytes(32), "t:u:google")).toThrow();
    expect(() => decryptSecret(enc, key, "t:other:google")).toThrow();
    const raw = Buffer.from(enc.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret("v1:" + raw.toString("base64"), key, "t:u:google")).toThrow();
    expect(() => decryptSecret("plain", key)).toThrow(/envelope/);
  });
  it("refuses a key that isn't 32 bytes", () => {
    expect(() => encryptSecret("x", randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe("OAuth state token", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  it("verifies a fresh token and returns user + tenant", () => {
    const t = signState({ u: "user-1", t: "tenant-1" }, key, now);
    const r = verifyState(t, key, now + 60_000);
    expect(r.ok && r.state).toMatchObject({ u: "user-1", t: "tenant-1" });
  });
  it("rejects tampering, another key, expiry and garbage", () => {
    const t = signState({ u: "user-1", t: "tenant-1" }, key, now);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "attacker" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, key, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyState(`${body}.${sig.slice(0, -2)}xx`, key, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyState(t, randomBytes(32), now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyState(t, key, now + 11 * 60_000)).toEqual({ ok: false, reason: "expired" });
    expect(verifyState("nope", key, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyState(null, key, now)).toEqual({ ok: false, reason: "malformed" });
  });
  it("each token carries its own nonce; cookie comparison is exact", () => {
    const a = signState({ u: "u", t: "t" }, key, now);
    const b = signState({ u: "u", t: "t" }, key, now);
    expect(a).not.toBe(b);
    expect(sameToken(a, a)).toBe(true);
    expect(sameToken(a, b)).toBe(false);
    expect(sameToken(a, undefined)).toBe(false);
  });
});
