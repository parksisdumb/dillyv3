"use client";
import { useEffect, useRef, useState } from "react";
import { prepareImage, currentPosition } from "@/lib/images/downscale";
import { newUuid } from "@/lib/offline/upload";
import { btn, cn } from "@/components/ui/styles";
import { IconCamera, IconX } from "@/components/icons";

/** A photo resized on the phone, waiting to go up with a log (or onto a building). */
export type PendingPhoto = {
  id: string;
  blob: Blob;
  url: string; // object URL for the thumbnail
  width: number;
  height: number;
  takenAt: string;
  lat: number | null;
  lng: number | null;
  caption: string;
  /** Set once uploaded, so a retry doesn't upload again. */
  path?: string | null;
};

const LOC_KEY = "dilly:photo-location";
function readLocPref(): boolean {
  try {
    return localStorage.getItem(LOC_KEY) === "1";
  } catch {
    return false;
  }
}
function writeLocPref(on: boolean) {
  try {
    localStorage.setItem(LOC_KEY, on ? "1" : "0");
  } catch {
    /* private mode: preference just isn't remembered */
  }
}

/** Resize + strip EXIF; attach the capture location only when the rep turned "Save where photos were taken" on. */
export async function preparePhotos(files: File[], withLocation: boolean): Promise<PendingPhoto[]> {
  const here = withLocation && files.length ? await currentPosition() : null;
  const out: PendingPhoto[] = [];
  for (const f of files) {
    const img = await prepareImage(f);
    const lat = withLocation ? img.exifLat ?? here?.lat ?? null : null;
    const lng = withLocation ? img.exifLng ?? here?.lng ?? null : null;
    out.push({ id: newUuid(), blob: img.blob, url: URL.createObjectURL(img.blob), width: img.width, height: img.height, takenAt: img.takenAt, lat, lng, caption: "" });
  }
  return out;
}

/**
 * "Add photos": camera or library (iOS offers both), multiple, resized to ≤1600 px JPEG before anything is stored or
 * sent. Thumbnails with remove; optional location toggle (off by default).
 */
export function PhotoPicker({
  photos,
  onChange,
  max = 8,
  label = "Add photos",
  hint,
  compact = false,
}: {
  photos: PendingPhoto[];
  onChange: (p: PendingPhoto[]) => void;
  max?: number;
  label?: string;
  hint?: React.ReactNode;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withLoc, setWithLoc] = useState(false);
  const latest = useRef(photos);
  latest.current = photos;

  useEffect(() => setWithLoc(readLocPref()), []);
  // Free thumbnails when the picker goes away.
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      const room = Math.max(0, max - latest.current.length);
      const picked = [...files].slice(0, room);
      const ready = await preparePhotos(picked, withLoc);
      onChange([...latest.current, ...ready]);
      if (files.length > room) setError(`Up to ${max} photos per log.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = (id: string) => {
    const p = photos.find((x) => x.id === id);
    if (p) URL.revokeObjectURL(p.url);
    onChange(photos.filter((x) => x.id !== id));
  };

  return (
    <div className="flex flex-col gap-2" data-testid="photo-picker">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative size-16 shrink-0 overflow-hidden rounded-lg border-2 border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={p.url} alt="Photo to attach" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="absolute right-0 top-0 inline-flex size-7 items-center justify-center rounded-bl-lg bg-ink/80 text-ground"
              aria-label="Remove photo"
            >
              <IconX size={14} />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className={cn(
              compact ? "size-16 flex-col gap-0.5 rounded-lg border-2 border-dashed border-line text-xs" : btn("secondary", "md", "border-dashed"),
              "inline-flex items-center justify-center text-ink disabled:opacity-50",
            )}
          >
            <IconCamera size={compact ? 20 : 20} />
            <span className={compact ? "label" : undefined}>{busy ? "Resizing…" : photos.length ? (compact ? "More" : "More photos") : label}</span>
          </button>
        )}
        <input ref={input} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} aria-label={label} onChange={(e) => void add(e.target.files)} />
      </div>
      {hint && !photos.length && <p className="text-sm text-muted">{hint}</p>}
      <label className="flex min-h-10 items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          className="size-5 accent-[var(--accent)]"
          checked={withLoc}
          onChange={(e) => {
            setWithLoc(e.target.checked);
            writeLocPref(e.target.checked);
          }}
        />
        Save where photos were taken
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
