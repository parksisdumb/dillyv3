import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { LoginForms } from "@/components/shell/login-forms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/app/today");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <span className="inline-block size-4 rounded-sm bg-accent" aria-hidden />
          <span className="label text-sm text-muted">Dilly</span>
        </div>
        <h1 className="mt-3 font-display text-4xl font-extrabold leading-none">Sign in</h1>
        <p className="mt-2 text-base text-muted">Your queue, your book, your numbers.</p>
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {error === "link" ? "That sign-in link expired or was already used. Send a new one." : error}
        </p>
      )}
      <LoginForms next={next ?? "/app/today"} />
    </main>
  );
}
