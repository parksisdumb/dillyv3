// Pure image math for the client-side downscale (src/lib/images/downscale.ts). Unit-tested.

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.8;

/** Scale (w, h) to fit inside max × max, never upscaling. Integer pixels, at least 1. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number; scale: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** EXIF orientations 5–8 rotate by 90°: the displayed image has width and height swapped. */
export function orientedSize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/**
 * Canvas transform that draws a raw (un-rotated) bitmap upright for an EXIF orientation, into a canvas of the
 * *oriented* size (outW × outH). Returns [a, b, c, d, e, f] for ctx.setTransform, and the size to draw the raw image
 * at (drawW × drawH, i.e. the raw image's scaled size).
 * Only used when the browser does NOT already apply EXIF orientation (pre-2020 engines).
 */
export function orientationTransform(
  orientation: number,
  outW: number,
  outH: number,
): { matrix: [number, number, number, number, number, number]; drawW: number; drawH: number } {
  const rotated = orientation >= 5 && orientation <= 8;
  const drawW = rotated ? outH : outW;
  const drawH = rotated ? outW : outH;
  let matrix: [number, number, number, number, number, number];
  switch (orientation) {
    case 2:
      matrix = [-1, 0, 0, 1, outW, 0];
      break;
    case 3:
      matrix = [-1, 0, 0, -1, outW, outH];
      break;
    case 4:
      matrix = [1, 0, 0, -1, 0, outH];
      break;
    case 5:
      matrix = [0, 1, 1, 0, 0, 0];
      break;
    case 6:
      matrix = [0, 1, -1, 0, outW, 0];
      break;
    case 7:
      matrix = [0, -1, -1, 0, outW, outH];
      break;
    case 8:
      matrix = [0, -1, 1, 0, 0, outH];
      break;
    default:
      matrix = [1, 0, 0, 1, 0, 0];
  }
  return { matrix, drawW, drawH };
}

/** Apply a 2D affine matrix to a point (for tests: where does a raw corner land?). */
export function applyMatrix(m: readonly number[], x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}
