import { describe, expect, it } from "vitest";
import { accessChangeProblem, assignableRoles, passwordProblem, roleChangeProblem, slugify, tempPassword, tempPasswordBits } from "@/lib/domain/admin";

describe("temporary passwords", () => {
  it("are 4×4 groups from an unambiguous alphabet with upper, lower and a digit", () => {
    for (let i = 0; i < 500; i++) {
      const p = tempPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });

  it("carry ≥ 90 bits and don't repeat", () => {
    expect(tempPasswordBits()).toBeGreaterThanOrEqual(90);
    const seen = new Set(Array.from({ length: 5000 }, () => tempPassword()));
    expect(seen.size).toBe(5000);
  });

  it("use every symbol roughly evenly (no modulo bias)", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) for (const ch of tempPassword().replace(/-/g, "")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(57);
    const avg = (4000 * 16) / 57;
    for (const n of counts.values()) expect(Math.abs(n - avg) / avg).toBeLessThan(0.2);
  });

  it("pass the rules a person's own password must meet", () => {
    expect(passwordProblem(tempPassword())).toBeNull();
    expect(passwordProblem("short1")).toMatch(/10/);
    expect(passwordProblem("alllowercaseletters")).toMatch(/Mix/);
    expect(passwordProblem("Roofing-2026!")).toBeNull();
  });
});

describe("role and access guards", () => {
  const owner = { userId: "o", role: "owner", isPlatformAdmin: false };
  const admin = { userId: "a", role: "admin", isPlatformAdmin: false };
  const manager = { userId: "m", role: "manager", isPlatformAdmin: false };
  const parks = { userId: "p", role: "rep", isPlatformAdmin: true };
  const rep = { userId: "r", role: "rep", active: true };
  const soleOwner = { userId: "o", role: "owner", active: true };
  const otherOwner = { userId: "o2", role: "owner", active: true };

  it("only owners/admins change roles, never their own", () => {
    expect(roleChangeProblem(manager, rep, "manager", 1)).toMatch(/Only owners and admins/);
    expect(roleChangeProblem(admin, { ...rep, userId: "a" }, "manager", 1)).toMatch(/your own role/);
    expect(roleChangeProblem(admin, rep, "manager", 1)).toBeNull();
    expect(roleChangeProblem(admin, rep, "rep", 1)).toMatch(/already/);
    expect(roleChangeProblem(admin, rep, "wizard", 1)).toMatch(/Unknown/);
  });

  it("owners are made and changed by owners (or the platform admin) only", () => {
    expect(roleChangeProblem(admin, rep, "owner", 1)).toMatch(/Only an owner/);
    expect(roleChangeProblem(admin, otherOwner, "admin", 2)).toMatch(/Only an owner/);
    expect(roleChangeProblem(owner, rep, "owner", 1)).toBeNull();
    expect(roleChangeProblem(parks, rep, "owner", 1)).toBeNull();
  });

  it("cannot demote or deactivate the last owner", () => {
    expect(roleChangeProblem(parks, soleOwner, "admin", 1)).toMatch(/last owner/);
    expect(roleChangeProblem({ ...owner, userId: "x" }, soleOwner, "admin", 2)).toBeNull();
    expect(accessChangeProblem(parks, soleOwner, false, 1)).toMatch(/last owner/);
    expect(accessChangeProblem(parks, soleOwner, false, 2)).toBeNull();
  });

  it("access: not yourself, not a no-op, owners only for owners", () => {
    expect(accessChangeProblem(admin, { ...rep, userId: "a" }, false, 1)).toMatch(/your own/);
    expect(accessChangeProblem(admin, rep, true, 1)).toMatch(/already have/);
    expect(accessChangeProblem(admin, otherOwner, false, 2)).toMatch(/Only an owner/);
    expect(accessChangeProblem(admin, rep, false, 1)).toBeNull();
    expect(accessChangeProblem(manager, rep, false, 1)).toMatch(/Only owners and admins/);
  });

  it("assignable roles narrow with the actor's role", () => {
    expect(assignableRoles(owner)).toContain("owner");
    expect(assignableRoles(admin)).not.toContain("owner");
    expect(assignableRoles(admin)).toContain("admin");
    expect(assignableRoles(manager)).toEqual(["manager", "rep", "estimator", "pm", "reviewer"]);
    expect(assignableRoles({ userId: "r", role: "rep", isPlatformAdmin: false })).toEqual([]);
  });

  it("slugs company names", () => {
    expect(slugify("Acme Roofing, LLC")).toBe("acme-roofing");
    expect(slugify("Smith & Sons Co.")).toBe("smith-and-sons");
  });
});
