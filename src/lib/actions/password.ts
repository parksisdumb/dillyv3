"use server";
// Password changes: the forced first-sign-in change (temporary password from an admin) and Settings → Password.
import { z } from "zod";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/domain/admin";
import type { ActionState } from "@/lib/actions/state";
import { log } from "@/lib/observability/log";

const schema = z.object({ password: z.string(), confirm: z.string(), then: z.string().optional() });

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const v = schema.safeParse({ password: fd.get("password") ?? "", confirm: fd.get("confirm") ?? "", then: fd.get("then") ?? undefined });
  if (!v.success) return { ok: false, error: "Enter the new password twice." };
  const problem = passwordProblem(v.data.password);
  if (problem) return { ok: false, error: problem, fields: { password: problem } };
  if (v.data.password !== v.data.confirm) return { ok: false, error: "The two passwords don't match.", fields: { confirm: "Doesn't match" } };
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await sb.auth.updateUser({ password: v.data.password });
  if (error && !/different from the old/i.test(error.message)) {
    log.warn("auth:password-change-failed", { err: error });
    return { ok: false, error: `Couldn't change the password: ${error.message}` };
  }
  if (error) return { ok: false, error: "Pick a password different from the temporary one." };
  if (user.app_metadata?.must_change_password) {
    const { error: e2 } = await supabaseAdmin().auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: false } });
    if (e2) return { ok: false, error: `Password changed, but couldn't finish setup: ${e2.message}` };
  }
  if (v.data.then === "app") redirect("/app/today");
  return { ok: true, message: "Password changed" };
}
