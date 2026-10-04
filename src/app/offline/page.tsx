import type { Metadata } from "next";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "No signal" };
// Static on purpose: the service worker precaches this page and shows it when a screen can't load.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="label text-xs text-muted">Dilly</p>
      <h1 className="mt-1 font-display text-3xl font-bold leading-tight">No signal.</h1>
      <p className="mt-2 text-base text-muted">This screen needs a connection to load, and logging a touch needs signal too.</p>
      <p className="mt-2 text-base text-muted">Everything you already logged is saved. Move to better signal, then try again.</p>
      <RetryButton />
    </main>
  );
}
