"use client";
import { useRef, useState } from "react";
import { scanBusinessCard } from "@/lib/actions/cards";
import type { CardFields } from "@/lib/cards/card";
import type { PickOption } from "@/lib/actions/book";
import { prepareImage } from "@/lib/images/downscale";
import { definitelyOffline } from "@/lib/offline/net";
import { newUuid, uploadImage } from "@/lib/offline/upload";
import { btn, cn } from "@/components/ui/styles";
import { IconCard } from "@/components/icons";

export type CardPrefill = { path: string | null; fields: CardFields | null; notes?: string | null; account?: PickOption | null; company?: string | null };

type State =
  | { s: "idle" }
  | { s: "working"; step: string; thumb: string }
  | { s: "done"; thumb: string; text: string }
  | { s: "fallback"; thumb: string | null; text: string };

/**
 * "Scan card": camera → resized photo → stored (contact.source_image_path) → Claude reads it → the form fills in for
 * the rep to check. If reading isn't configured or fails, it says so and the rep types — it never blocks the form.
 */
export function CardScanButton({ onRead, initial }: { onRead: (c: CardPrefill) => void; initial?: { thumb: string; text: string } }) {
  const input = useRef<HTMLInputElement>(null);
  const [st, setSt] = useState<State>(initial ? { s: "done", ...initial } : { s: "idle" });

  const run = async (file: File | undefined) => {
    if (!file) return;
    if (definitelyOffline()) {
      setSt({ s: "fallback", thumb: null, text: "Card scan needs signal — type the details in." });
      return;
    }
    let thumb: string | null = null;
    try {
      const img = await prepareImage(file);
      thumb = URL.createObjectURL(img.blob);
      setSt({ s: "working", step: "Uploading card…", thumb });
      const id = newUuid();
      let up;
      try {
        up = await uploadImage({ id, blob: img.blob, takenAt: img.takenAt, kind: "card" });
      } catch {
        setSt({ s: "fallback", thumb, text: "Lost signal sending the card — type the details in." });
        return;
      }
      if (!up.ok) {
        setSt({ s: "fallback", thumb, text: `${up.error} Type the details in.` });
        return;
      }
      onRead({ path: up.path, fields: null });
      setSt({ s: "working", step: "Reading card…", thumb });
      const r = await scanBusinessCard({ path: up.path }).catch(() => null);
      if (!r) {
        setSt({ s: "fallback", thumb, text: "Lost signal reading the card — type the details in. The photo is saved." });
        return;
      }
      if (!r.ok) {
        setSt({ s: "fallback", thumb, text: r.message });
        return;
      }
      onRead({ path: up.path, fields: r.fields, notes: r.notes, account: r.account, company: r.company });
      const acct = r.account ? ` Matched ${r.account.label}.` : "";
      setSt({ s: "done", thumb, text: `Filled in from the card — check it, then add.${acct}` });
    } catch (e) {
      setSt({ s: "fallback", thumb, text: e instanceof Error ? `${e.message} Type the details in.` : "Couldn't read that photo — type the details in." });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const thumb = st.s === "idle" ? null : st.thumb;
  return (
    <div className="flex flex-col gap-2" data-testid="card-scan">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={st.s === "working"}
          className={btn("secondary", "md", "flex-1 border-dashed")}
        >
          <IconCard size={20} /> {st.s === "working" ? st.step : st.s === "idle" ? "Scan business card" : "Scan again"}
        </button>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL
          <img src={thumb} alt="Business card" className="h-12 w-20 shrink-0 rounded-md border-2 border-line object-cover" />
        )}
      </div>
      {/* capture: straight to the back camera on phones (a card is always a fresh photo) */}
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-label="Business card photo" onChange={(e) => void run(e.target.files?.[0])} />
      {(st.s === "done" || st.s === "fallback") && (
        <p role="status" className={cn("rounded-lg px-3 py-2 text-sm", st.s === "done" ? "bg-surface-2" : "border-2 border-warning bg-warning/10")}>
          {st.text}
        </p>
      )}
    </div>
  );
}
