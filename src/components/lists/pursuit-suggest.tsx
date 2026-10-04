"use client";
// Post-log nudge: "Mark Riverside active?" — never automatic, one tap to accept. The Log sheet calls
// suggestPursuit(propertyId) after a successful (sent, not queued) log at a building.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPursuit } from "@/lib/actions/lists";
import { useToast } from "@/components/ui/toast";
import { btn } from "@/components/ui/styles";
import { IconTarget, IconX } from "@/components/icons";

const EVENT = "dilly:suggest-pursuit";

export function suggestPursuit(propertyId: string | null | undefined) {
  if (!propertyId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { propertyId } }));
}

export function PursuitSuggest() {
  const [s, setS] = useState<{ propertyId: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ propertyId: string }>).detail?.propertyId;
      if (!id) return;
      void fetch(`/app/lists/hint?property=${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ suggest: boolean; name: string }>) : null))
        .then((h) => (h?.suggest ? setS({ propertyId: id, name: h.name }) : null))
        .catch(() => {});
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  useEffect(() => {
    if (!s) return;
    const h = setTimeout(() => setS(null), 9000);
    return () => clearTimeout(h);
  }, [s]);

  if (!s) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+212px)] z-50 flex justify-center px-4">
      <div role="dialog" aria-label="Mark active" className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-lg border-2 border-accent bg-surface px-3 py-2 shadow-lg">
        <IconTarget size={20} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 text-sm font-semibold">Mark {s.name} active?</span>
        <button
          type="button"
          disabled={pending}
          className={btn("primary", "sm")}
          onClick={() =>
            start(async () => {
              const r = await setPursuit({ propertyIds: [s.propertyId], status: "active" }).catch(() => ({ ok: false as const, error: "Couldn't save." }));
              setS(null);
              toast(r.ok ? r.message : r.error, r.ok ? "good" : "bad");
              if (r.ok) router.refresh();
            })
          }
        >
          Mark active
        </button>
        <button type="button" onClick={() => setS(null)} className="inline-flex size-12 items-center justify-center rounded-lg" aria-label="Not now">
          <IconX size={18} />
        </button>
      </div>
    </div>
  );
}
