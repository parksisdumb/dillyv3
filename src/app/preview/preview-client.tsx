"use client";
// Dev-only helpers for /preview: open the Log sheet at a given step, or show a toast, without a server.
import { useEffect, useState } from "react";
import { LogSheet } from "@/components/log/log-sheet";
import { useToast } from "@/components/ui/toast";
import type { ContactOption, LogContextData } from "@/lib/actions/log-types";
import type { Channel } from "@/lib/domain/vocab";
import type { PendingPhoto } from "@/components/photos/photo-picker";
import type { CardPrefill } from "@/components/log/card-scan";
import { QuickContactForm } from "@/components/log/quick-contact-form";
import { ScheduleSheet } from "@/components/appointments/schedule-sheet";
import type { ScheduleContext } from "@/lib/appointments/types";

export function PreviewLogSheet({ data, contact, picking, channel }: { data: LogContextData; contact: ContactOption | null; picking?: boolean; channel?: Channel | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  return <LogSheet open={open} target={{ accountId: data.account?.id }} onClose={() => setOpen(false)} initial={{ data, contact, picking, channel }} />;
}

export function PreviewToast({ text }: { text: string }) {
  const { toast } = useToast();
  useEffect(() => {
    toast(text);
  }, [toast, text]);
  return null;
}

/** Log sheet on a roof walk with details open and two photos attached (canvas-drawn placeholders). */
export function PreviewLogPhotos({ data, contact }: { data: LogContextData; contact: ContactOption | null }) {
  const [photos, setPhotos] = useState<PendingPhoto[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(
      [
        ["#8d9196", "#5f646a", "Bldg C · drain"],
        ["#9aa0a3", "#6b7378", "Seam split"],
      ].map(
        ([a, b, label]) =>
          new Promise<PendingPhoto>((resolve) => {
            const c = document.createElement("canvas");
            c.width = 400;
            c.height = 300;
            const g = c.getContext("2d")!;
            const grd = g.createLinearGradient(0, 0, 400, 300);
            grd.addColorStop(0, a);
            grd.addColorStop(1, b);
            g.fillStyle = grd;
            g.fillRect(0, 0, 400, 300);
            g.fillStyle = "rgba(0,0,0,.4)";
            g.fillRect(0, 250, 400, 50);
            g.fillStyle = "#fff";
            g.font = "24px sans-serif";
            g.fillText(label, 14, 284);
            c.toBlob((blob) => resolve({ id: crypto.randomUUID(), blob: blob!, url: URL.createObjectURL(blob!), width: 400, height: 300, takenAt: new Date().toISOString(), lat: null, lng: null, caption: "" }), "image/jpeg", 0.8);
          }),
      ),
    ).then((p) => live && setPhotos(p));
    return () => {
      live = false;
    };
  }, []);
  if (!photos) return null;
  return <LogSheet open target={{ accountId: data.account?.id }} onClose={() => {}} initial={{ data, contact, channel: "roof_walk", details: true, photos }} />;
}

/** Add-contact form as if a business card was just read. */
export function PreviewCardScan({ preview }: { preview: { prefill: CardPrefill; text: string; thumb: string } }) {
  return <QuickContactForm pickAccount source="field" submitLabel="Add contact" onDone={() => {}} preview={preview} />;
}

/** Schedule sheet open on an account with three of its buildings picked (the "series of apartments" case). */
export function PreviewScheduleSheet({ initial }: { initial: ScheduleContext }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  return <ScheduleSheet open={open} onClose={() => setOpen(false)} target={{ accountId: initial.account?.id }} initial={initial} />;
}
