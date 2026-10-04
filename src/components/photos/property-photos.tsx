"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPropertyPhotos, updatePhotoCaption } from "@/lib/actions/photos";
import { uploadImage } from "@/lib/offline/upload";
import { definitelyOffline } from "@/lib/offline/net";
import { PhotoPicker, type PendingPhoto } from "@/components/photos/photo-picker";
import { Sheet } from "@/components/ui/sheet";
import { SectionTitle } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconCamera } from "@/components/icons";
import { shortDate } from "@/lib/format";

export type PhotoTile = {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
  mine: boolean;
  width: number | null;
  height: number | null;
  touchId: string | null;
};

/** Property detail → Photos: grid (newest first), add with captions, tap for the big view + caption edit. */
export function PropertyPhotos({ propertyId, photos, preview }: { propertyId: string; photos: PhotoTile[]; preview?: { adding?: PendingPhoto[] } }) {
  const router = useRouter();
  const { toast } = useToast();
  const [adding, setAdding] = useState<PendingPhoto[]>(preview?.adding ?? []);
  const [open, setOpen] = useState<PhotoTile | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? photos : photos.slice(0, 9);

  const save = () =>
    start(async () => {
      setError(null);
      if (definitelyOffline()) {
        setError("No signal. Your photos stay here — tap Save when you have bars, or log a roof walk to queue them.");
        return;
      }
      try {
        for (const p of adding) {
          if (p.path) continue;
          const r = await uploadImage({ id: p.id, blob: p.blob, takenAt: p.takenAt });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          p.path = r.path;
        }
      } catch {
        setError("Lost signal while uploading. Tap Save again — nothing uploads twice.");
        return;
      }
      const r = await addPropertyPhotos({
        propertyId,
        photos: adding.map((p) => ({ id: p.id, path: p.path!, width: p.width, height: p.height, takenAt: p.takenAt, lat: p.lat, lng: p.lng, caption: p.caption || null })),
      }).catch(() => ({ ok: false as const, error: "Lost signal. Tap Save again — nothing uploads twice." }));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      adding.forEach((p) => URL.revokeObjectURL(p.url));
      setAdding([]);
      toast(r.added === 1 ? "Photo added" : `${r.added} photos added`);
      router.refresh();
    });

  const saveCaption = () =>
    start(async () => {
      if (!open) return;
      const r = await updatePhotoCaption({ id: open.id, caption }).catch(() => ({ ok: false as const, error: "No signal — try again." }));
      if (!r.ok) {
        toast(r.error, "bad");
        return;
      }
      toast("Caption saved");
      setOpen(null);
      router.refresh();
    });

  return (
    <section aria-label="Photos" data-testid="property-photos">
      <SectionTitle
        action={
          <span className="num label text-xs text-muted">
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </span>
        }
      >
        Photos
      </SectionTitle>
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-1.5 px-4">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(p);
                  setCaption(p.caption ?? "");
                }}
                className="block w-full text-left"
                aria-label={`Photo${p.caption ? `: ${p.caption}` : ""}, ${shortDate(p.takenAt)}${p.by ? ` by ${p.by}` : ""}`}
              >
                <span className="block aspect-square overflow-hidden rounded-md bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring URLs: no image optimizer */}
                  <img src={p.url} alt={p.caption ?? "Roof photo"} loading="lazy" className="size-full object-cover" />
                </span>
                <span className="mt-0.5 block truncate text-xs">{p.caption || <span className="text-muted">{shortDate(p.takenAt)}</span>}</span>
                <span className="block truncate text-[11px] leading-tight text-muted">
                  {p.caption ? `${shortDate(p.takenAt)} · ` : ""}
                  {p.by ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {photos.length > 9 && !showAll && (
        <button type="button" className={btn("ghost", "sm", "mx-4 mt-1 text-muted")} onClick={() => setShowAll(true)}>
          Show all {photos.length}
        </button>
      )}
      {photos.length === 0 && adding.length === 0 && (
        <p className="px-4 text-sm text-muted">No photos yet. Roof walks with photos earn site-walk points — add them from Log, or here.</p>
      )}

      <div className={cn("px-4", photos.length > 0 || adding.length > 0 ? "mt-3" : "mt-2")}>
        <PhotoPicker photos={adding} onChange={setAdding} max={12} label="Add photos" />
        {adding.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {adding.map((p, i) => (
              <label key={p.id} className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img src={p.url} alt="" className="size-12 shrink-0 rounded-md object-cover" />
                <input
                  className={input}
                  value={p.caption}
                  maxLength={300}
                  placeholder={`Caption for photo ${i + 1} (optional)`}
                  onChange={(e) => setAdding((xs) => xs.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x)))}
                />
              </label>
            ))}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <button type="button" onClick={save} disabled={pending} className={btn("primary", "md", "w-full")}>
              <IconCamera size={20} /> {pending ? "Uploading…" : `Save ${adding.length} photo${adding.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title="Photo" labelledBy="photo-sheet">
        {open && (
          <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL */}
            <img src={open.url} alt={open.caption ?? "Roof photo"} className="max-h-[55dvh] w-full rounded-lg bg-surface-2 object-contain" />
            <p className="text-sm text-muted">
              {shortDate(open.takenAt)}
              {open.by && <> · {open.by}</>}
              {open.touchId && <> · from a logged visit</>}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Caption</span>
              <input className={input} value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} placeholder="Ponding at the west drain" />
            </label>
            <button type="button" onClick={saveCaption} disabled={pending || caption === (open.caption ?? "")} className={btn("primary", "md", "w-full")}>
              Save caption
            </button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
