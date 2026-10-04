"use server";
import { z } from "zod";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getSession, TENANT_COOKIE } from "@/lib/session";
import type { ActionState } from "@/lib/actions/state";
import { safeNext } from "@/lib/server/safe-next";
import { log } from "@/lib/observability/log";

const OFFLINE = "Can't reach the server. Check your signal and try again.";
const unreachable = (e: { name?: string; status?: number }) =>
  e.name === "AuthRetryableFetchError" || e.status === 0 || (typeof e.status === "number" && e.status >= 500);

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export async function signInWithPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({ email: fd.get("email"), password: fd.get("password"), next: fd.get("next") ?? undefined });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    if (error.message === "Invalid login credentials") return { ok: false, error: "Wrong email or password." };
    log.warn("auth:sign-in-failed", { err: error });
    return { ok: false, error: unreachable(error) ? OFFLINE : error.message };
  }
  redirect(safeNext(parsed.data.next));
}

const magicSchema = z.object({ email: z.string().trim().email("Enter a valid email"), next: z.string().optional() });

export async function sendMagicLink(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = magicSchema.safeParse({ email: fd.get("email"), next: fd.get("next") ?? undefined });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid email." };
  const h = await headers();
  // Configured app URL first: the Origin header is client-controlled.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    h.get("origin") ??
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(parsed.data.next))}`,
      shouldCreateUser: true,
    },
  });
  if (error) {
    log.warn("auth:magic-link-failed", { err: error });
    return { ok: false, error: unreachable(error) ? OFFLINE : error.message };
  }
  return { ok: true, message: `Link sent to ${parsed.data.email}. Open it on this phone.` };
}

export async function signOut(): Promise<void> {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

export async function switchTenant(slug: string): Promise<void> {
  const s = await getSession();
  if (!s.tenants.some((t) => t.slug === slug)) return;
  const store = await cookies();
  store.set(TENANT_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  redirect("/app/today");
}
