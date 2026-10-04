"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { currentPosition } from "@/lib/images/downscale";
import { cn } from "@/components/ui/styles";
import { hrefWith } from "@/components/accounts/filter-chip";

/** Properties → Sort: Nearby. Asks the phone where it is, then reloads the list sorted by distance (server-side). */
export function NearbySort({ base, sp, active }: { base: string; sp: Record<string, string | undefined>; active: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "locating" | "denied">("idle");
  return (
    <>
      <button
        type="button"
        className={cn("inline-flex min-h-12 items-center px-1", active && "font-semibold text-ink")}
        onClick={() => {
          setState("locating");
          void currentPosition(8000).then((p) => {
            if (!p) return setState("denied");
            setState("idle");
            router.push(hrefWith(base, sp, { sort: "near", near: `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` }));
          });
        }}
      >
        {state === "locating" ? "Finding you…" : "Nearby"}
      </button>
      {state === "denied" && (
        <span role="status" className="block w-full text-right text-xs text-warning">
          Allow location for Dilly to sort by distance.
        </span>
      )}
    </>
  );
}
