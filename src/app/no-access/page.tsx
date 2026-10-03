import type { Metadata } from "next";
import { signOut } from "@/lib/actions/auth";
import { btn } from "@/components/ui/styles";

export const metadata: Metadata = { title: "No access" };

export default function NoAccess() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <h1 className="font-display text-4xl font-extrabold leading-none">No company yet</h1>
      <p className="mt-3 text-base text-muted">
        You&apos;re signed in, but this email isn&apos;t on any company&apos;s team in Dilly. Ask your manager to invite this exact address, then sign in
        again.
      </p>
      <form action={signOut} className="mt-8">
        <button type="submit" className={btn("secondary", "lg", "w-full")}>
          Sign out
        </button>
      </form>
    </main>
  );
}
