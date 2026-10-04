import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { changePassword } from "@/lib/actions/password";
import { signOut } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/fields";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/** First sign-in with a temporary password from an admin: pick your own before anything else. */
export default async function WelcomePasswordPage() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  if (!user.app_metadata?.must_change_password) redirect("/app/today");
  return (
    <ToastProvider>
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="inline-block size-4 rounded-sm bg-accent" aria-hidden />
            <span className="label text-sm text-muted">Dilly</span>
          </div>
          <h1 className="mt-3 font-display text-4xl font-extrabold leading-none">Set your password</h1>
          <p className="mt-2 text-base text-muted">
            You signed in with a temporary password. Pick your own to finish — {user.email}.
          </p>
        </div>
        <ActionForm action={changePassword} submitLabel="Save and continue">
          <input type="hidden" name="then" value="app" />
          <input type="hidden" name="username" value={user.email ?? ""} autoComplete="username" />
          <TextField label="New password" name="password" type="password" required autoComplete="new-password" hint="10+ characters, letters with numbers or symbols" />
          <TextField label="Type it again" name="confirm" type="password" required autoComplete="new-password" />
        </ActionForm>
        <form action={signOut} className="mt-6 text-center">
          <button type="submit" className="min-h-12 text-sm text-muted underline">
            Sign out
          </button>
        </form>
      </main>
    </ToastProvider>
  );
}
