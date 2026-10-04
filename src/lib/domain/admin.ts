// Admin rules (pure): temporary passwords and who may change whose role / access. The database enforces the
// last-owner rule again (app.membership_owner_guard) and RLS enforces owner/admin for membership writes.
import { ROLES, type Role } from "@/lib/domain/vocab";

// No 0/O, 1/l/I: these get read aloud or typed off a screen.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const ALL = UPPER + LOWER + DIGIT;

function randomIndex(n: number): number {
  // Rejection sampling: no modulo bias.
  const limit = Math.floor(256 / n) * n;
  const b = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0]! < limit) return b[0]! % n;
  }
}

/**
 * A one-time password shown once to an admin: 4 groups of 4 ("Kq7m-Rt3p-9xWd-Fh2a"). 16 random characters from a
 * 57-symbol alphabet ≈ 93 bits, always with upper, lower and a digit. The person must change it at first sign-in.
 */
export function tempPassword(groups = 4, size = 4): string {
  for (;;) {
    const chars = Array.from({ length: groups * size }, () => ALL[randomIndex(ALL.length)]!);
    const s = chars.join("");
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) {
      const out: string[] = [];
      for (let i = 0; i < groups; i++) out.push(s.slice(i * size, (i + 1) * size));
      return out.join("-");
    }
  }
}

/** Bits of entropy of tempPassword() output (for the test and the UI note). */
export function tempPasswordBits(groups = 4, size = 4): number {
  return Math.floor(groups * size * Math.log2(ALL.length));
}

/** A new password a person picks: 10+ characters, not all one kind. Returns the problem, or null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 72) return "Use 72 characters or fewer.";
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds < 2) return "Mix letters with numbers or symbols.";
  return null;
}

export type Actor = { userId: string; role: Role | string; isPlatformAdmin: boolean };
export type Target = { userId: string; role: Role | string; active: boolean };

const ownerish = (a: Actor) => a.isPlatformAdmin || a.role === "owner" || a.role === "admin";
const isOwnerActor = (a: Actor) => a.isPlatformAdmin || a.role === "owner";

/** Why this role change is not allowed, or null. `activeOwners` = active owners in the company now. */
export function roleChangeProblem(actor: Actor, target: Target, to: string, activeOwners: number): string | null {
  if (!(ROLES as readonly string[]).includes(to)) return "Unknown role.";
  if (!ownerish(actor)) return "Only owners and admins change roles.";
  if (actor.userId === target.userId) return "You can't change your own role — ask another owner or admin.";
  if (target.role === to) return "They already have that role.";
  if ((to === "owner" || target.role === "owner") && !isOwnerActor(actor)) return "Only an owner can make or change an owner.";
  if (target.role === "owner" && target.active && activeOwners <= 1) return "They're the last owner — make someone else owner first.";
  return null;
}

/** Why this person can't be deactivated (active=false) or reactivated, or null. */
export function accessChangeProblem(actor: Actor, target: Target, active: boolean, activeOwners: number): string | null {
  if (!ownerish(actor)) return "Only owners and admins change access.";
  if (actor.userId === target.userId) return "You can't change your own access.";
  if (target.active === active) return active ? "They already have access." : "They're already deactivated.";
  if (target.role === "owner" && !isOwnerActor(actor)) return "Only an owner can deactivate an owner.";
  if (!active && target.role === "owner" && activeOwners <= 1) return "They're the last owner — make someone else owner first.";
  return null;
}

/** Roles this actor may hand out (invite / change role). */
export function assignableRoles(actor: Actor): Role[] {
  if (isOwnerActor(actor)) return [...ROLES];
  if (actor.role === "admin") return ROLES.filter((r) => r !== "owner");
  if (actor.role === "manager") return ROLES.filter((r) => r !== "owner" && r !== "admin");
  return [];
}

/** "acme-roofing" from "Acme Roofing, LLC". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(llc|inc|co|corp|ltd)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
