"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { log, newId, shortRef } from "@/lib/observability/log";
import { btn } from "@/components/ui/styles";

export type BoundaryProps = { error: Error & { digest?: string }; reset: () => void };

/**
 * Calm, field-language failure screen used by every error.tsx.
 * - "Try again" re-fetches the server component (router.refresh) and resets the boundary.
 * - "Go to Today" is always a safe exit.
 * - The reference is the server digest when there is one (it appears in the Vercel logs next to the stack),
 *   otherwise a client id; reps read it out to support.
 */
export function ErrorScreen({ error, reset, where, inShell = true }: BoundaryProps & { where?: string; inShell?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [clientId] = useState(() => newId());
  const [offline, setOffline] = useState(false);
  const ref = shortRef(error.digest ?? clientId);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    log.error("boundary", { route: pathname, where: where ?? null, ref, digest: error.digest ?? null, err: error });
  }, [error, pathname, ref, where]);

  const retry = () =>
    start(() => {
      router.refresh();
      reset();
    });

  return (
    <div className={inShell ? "px-4 pt-8" : "mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10"} role="alert">
      <div className="rounded-lg border-2 border-line bg-surface px-4 py-6">
        <p className="label text-xs text-muted">{where ?? "Dilly"}</p>
        <h1 className="mt-1 font-display text-2xl font-bold leading-tight">
          {offline ? "No signal right now." : "That didn't load."}
        </h1>
        <p className="mt-2 text-base text-muted">
          {offline
            ? "Your phone looks offline. Anything you already logged is saved — try again when you have bars."
            : "Something on our end hiccuped. Anything you already logged is saved. Give it another try."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={retry} disabled={pending} className={btn("primary", "lg", "w-full sm:w-auto")}>
            {pending ? "Trying…" : "Try again"}
          </button>
          <Link href="/app/today" className={btn("secondary", "lg", "w-full sm:w-auto")}>
            Go to Today
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">
          Ref <span className="num font-semibold">{ref}</span> — mention it if this keeps happening.
        </p>
      </div>
    </div>
  );
}
