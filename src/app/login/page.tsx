import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { LoginForms } from "@/components/shell/login-forms";
import { safeNext } from "@/lib/server/safe-next";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; offline?: string }> }) {
  const { next: rawNext, error, offline } = await searchParams;
  const next = safeNext(rawNext);
  // When middleware already couldn't reach auth, don't make the rep wait on it again: render the form now.
  if (!offline) {
    const sb = await supabaseServer();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) redirect(next);
  }

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
      {offline && (
        <div role="status" className="mb-4 rounded-lg border-2 border-line px-3 py-2 text-sm">
          <p className="font-semibold">Can&apos;t reach the server right now.</p>
          <p className="mt-1 text-muted">You&apos;re probably still signed in. Check your signal, then try again.</p>
          <a href={next} className="mt-2 inline-block font-semibold underline">
            Try again
          </a>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {error === "link" ? "That sign-in link expired or was already used. Send a new one." : "Couldn't sign you in. Try again."}
        </p>
      )}
      <LoginForms next={next} />
    </main>
  );
}
