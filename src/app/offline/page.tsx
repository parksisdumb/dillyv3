import type { Metadata } from "next";
import { RetryButton } from "@/components/pwa/retry-button";
import { OfflineCount } from "@/components/offline/offline-count";

export const metadata: Metadata = { title: "No signal" };
// Static on purpose: the service worker precaches this page and shows it when a screen can't load.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="label text-xs text-muted">Dilly</p>
      <h1 className="mt-1 font-display text-3xl font-bold leading-tight">No signal.</h1>
      <p className="mt-2 text-base text-muted">This screen needs a connection to load.</p>
      <p className="mt-2 text-base text-muted">
        Logging still works without signal on a screen that&apos;s already open — Go, or the account you&apos;re at. Those logs (and their
        photos) are saved on this phone and send by themselves, in order, when you have bars. Nothing logs twice.
      </p>
      <OfflineCount />
      <RetryButton />
    </main>
  );
}
