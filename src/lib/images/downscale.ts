"use client";
// Phone → upload-ready JPEG: max 1600 px on the long edge, quality ~0.8, upright, NO EXIF (canvas re-encode drops
// every tag, GPS included). Typical roof photo: 4–12 MB in, 250–600 KB out — uploads on one bar of LTE.
import { fitWithin, JPEG_QUALITY, MAX_EDGE, orientationTransform, orientedSize } from "@/lib/images/fit";
import { readExif, type ExifInfo } from "@/lib/images/exif";

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
  /** From EXIF (or the file's timestamp); the photo's capture time. */
  takenAt: string;
  /** EXIF GPS, read only so the caller can store it as fields when the rep allows location. Never in the JPEG. */
  exifLat: number | null;
  exifLng: number | null;
};

/** Browsers from 2020 on (Chrome 81, Safari 13.1, Firefox 77) draw <img> upright already. */
function browserAppliesOrientation(): boolean {
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("image-orientation", "from-image");
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This photo couldn't be read. Try another, or take it again."));
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the photo."))), "image/jpeg", quality),
  );
}

export async function prepareImage(file: Blob, opts: { maxEdge?: number; quality?: number } = {}): Promise<PreparedImage> {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const quality = opts.quality ?? JPEG_QUALITY;
  let exif: ExifInfo = { orientation: 1, takenAt: null, lat: null, lng: null };
  try {
    // EXIF lives in the first 128 KB of a JPEG.
    exif = readExif(await file.slice(0, 128 * 1024).arrayBuffer());
  } catch {
    /* not a JPEG (PNG/HEIC→JPEG conversions) — defaults */
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const auto = browserAppliesOrientation();
    // naturalWidth/Height are already oriented when the browser applies EXIF orientation.
    const orientation = auto ? 1 : exif.orientation;
    const shown = orientedSize(img.naturalWidth, img.naturalHeight, orientation);
    const { width, height } = fitWithin(shown.width, shown.height, maxEdge);
    if (!width || !height) throw new Error("This photo couldn't be read. Try another, or take it again.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't prepare the photo.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const { matrix, drawW, drawH } = orientationTransform(orientation, width, height);
    ctx.setTransform(...matrix);
    ctx.drawImage(img, 0, 0, drawW, drawH);
    const blob = await toBlob(canvas, quality);
    canvas.width = canvas.height = 0; // free the bitmap now (iOS keeps canvases alive)
    const fileTime = file instanceof File && file.lastModified ? new Date(file.lastModified).toISOString() : null;
    return { blob, width, height, takenAt: exif.takenAt ?? fileTime ?? new Date().toISOString(), exifLat: exif.lat, exifLng: exif.lng };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Current position if the rep allows it (never prompts more than the browser does); null otherwise. */
export function currentPosition(timeoutMs = 6000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const t = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(t);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120_000 },
    );
  });
}
