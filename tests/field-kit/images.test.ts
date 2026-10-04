import { describe, expect, it } from "vitest";
import { applyMatrix, fitWithin, orientationTransform, orientedSize } from "@/lib/images/fit";
import { readExif } from "@/lib/images/exif";

describe("downscale math", () => {
  it("fits the long edge to 1600 and never upscales", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200, scale: 1600 / 4032 });
    expect(fitWithin(3024, 4032)).toMatchObject({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toMatchObject({ width: 800, height: 600, scale: 1 });
    expect(fitWithin(1600, 1600)).toMatchObject({ width: 1600, height: 1600 });
    expect(fitWithin(10000, 10)).toMatchObject({ width: 1600, height: 2 });
    expect(fitWithin(20000, 1)).toMatchObject({ width: 1600, height: 1 }); // at least 1px
    expect(fitWithin(0, 100)).toMatchObject({ width: 0, height: 0 });
    expect(fitWithin(5000, 4000, 1000)).toMatchObject({ width: 1000, height: 800 });
  });

  it("orientations 5–8 swap width and height", () => {
    expect(orientedSize(4032, 3024, 1)).toEqual({ width: 4032, height: 3024 });
    expect(orientedSize(4032, 3024, 3)).toEqual({ width: 4032, height: 3024 });
    for (const o of [5, 6, 7, 8]) expect(orientedSize(4032, 3024, o)).toEqual({ width: 3024, height: 4032 });
  });

  it("orientation transforms put every raw corner inside the output canvas, upright", () => {
    // A portrait phone photo stored landscape (4:3 raw) with orientation 6 → output 1200×1600.
    const outW = 1200;
    const outH = 1600;
    for (let o = 1; o <= 8; o++) {
      const W = o >= 5 ? outH : outW;
      const H = o >= 5 ? outW : outH;
      const { matrix, drawW, drawH } = orientationTransform(o, W, H);
      const corners = [
        [0, 0],
        [drawW, 0],
        [0, drawH],
        [drawW, drawH],
      ].map(([x, y]) => applyMatrix(matrix, x, y));
      for (const [x, y] of corners) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(W + 1e-9);
        expect(y).toBeLessThanOrEqual(H + 1e-9);
      }
    }
    // Orientation 6 (rotate 90° clockwise): the raw top-left lands top-right.
    const six = orientationTransform(6, 1200, 1600);
    expect(applyMatrix(six.matrix, 0, 0)).toEqual([1200, 0]);
    expect(six.drawW).toBe(1600);
    expect(six.drawH).toBe(1200);
    // Orientation 3 (180°): top-left → bottom-right.
    expect(applyMatrix(orientationTransform(3, 100, 50).matrix, 0, 0)).toEqual([100, 50]);
  });
});

/** Build a minimal JPEG with an APP1 EXIF block: orientation, DateTimeOriginal, GPS. */
function jpegWithExif(o: { orientation?: number; dt?: string; lat?: [number, number, number, "N" | "S"]; lng?: [number, number, number, "E" | "W"]; little?: boolean }): ArrayBuffer {
  const little = o.little ?? false;
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v: number) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  // Layout: header(8) | IFD0 at 8 | ExifIFD | GPS IFD | data area
  const ifd0Entries = 3;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = 2 + 1 * 12 + 4;
  const gpsOff = exifOff + exifSize;
  const gpsSize = 2 + 4 * 12 + 4;
  const dataOff = gpsOff + gpsSize;
  const data: number[] = [];
  const put = (bytes: number[]) => {
    const at = dataOff + data.length;
    data.push(...bytes);
    return at;
  };
  const dtBytes = [...(o.dt ?? "2026:10:05 09:30:00")].map((c) => c.charCodeAt(0)).concat([0]);
  const dtAt = put(dtBytes);
  const rat = (d: number, m: number, s: number) => [...u32(d), ...u32(1), ...u32(m), ...u32(1), ...u32(Math.round(s * 100)), ...u32(100)];
  const lat = o.lat ?? [30, 16, 1.92, "N"];
  const lng = o.lng ?? [97, 44, 35.16, "W"];
  const latAt = put(rat(lat[0], lat[1], lat[2]));
  const lngAt = put(rat(lng[0], lng[1], lng[2]));

  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  const entry = (tag: number, type: number, count: number, value: number[]) => [...u16(tag), ...u16(type), ...u32(count), ...value];
  const inline16 = (v: number) => [...u16(v), 0, 0];
  const inlineAscii = (s: string) => [...[...s].map((c) => c.charCodeAt(0)), 0, 0, 0, 0].slice(0, 4);
  tiff.push(...u16(ifd0Entries));
  tiff.push(...entry(0x0112, 3, 1, inline16(o.orientation ?? 6)));
  tiff.push(...entry(0x8769, 4, 1, u32(exifOff)));
  tiff.push(...entry(0x8825, 4, 1, u32(gpsOff)));
  tiff.push(...u32(0));
  tiff.push(...u16(1), ...entry(0x9003, 2, dtBytes.length, u32(dtAt)), ...u32(0));
  tiff.push(...u16(4));
  tiff.push(...entry(0x0001, 2, 2, inlineAscii(lat[3])));
  tiff.push(...entry(0x0002, 5, 3, u32(latAt)));
  tiff.push(...entry(0x0003, 2, 2, inlineAscii(lng[3])));
  tiff.push(...entry(0x0004, 5, 3, u32(lngAt)));
  tiff.push(...u32(0));
  tiff.push(...data);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9];
  return new Uint8Array(bytes).buffer;
}

describe("EXIF reader", () => {
  it("reads orientation, capture time and GPS (big-endian)", () => {
    const e = readExif(jpegWithExif({ orientation: 6 }));
    expect(e.orientation).toBe(6);
    expect(e.takenAt).toBe(new Date(2026, 9, 5, 9, 30, 0).toISOString());
    expect(e.lat).toBeCloseTo(30 + 16 / 60 + 1.92 / 3600, 6);
    expect(e.lng).toBeCloseTo(-(97 + 44 / 60 + 35.16 / 3600), 6);
  });
  it("reads little-endian files and southern/eastern hemispheres", () => {
    const e = readExif(jpegWithExif({ little: true, orientation: 3, lat: [33, 52, 0, "S"], lng: [151, 12, 0, "E"] }));
    expect(e.orientation).toBe(3);
    expect(e.lat).toBeCloseTo(-(33 + 52 / 60), 6);
    expect(e.lng).toBeCloseTo(151.2, 6);
  });
  it("is safe on non-JPEG and truncated input", () => {
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ orientation: 1, takenAt: null, lat: null, lng: null });
    expect(readExif(jpegWithExif({}).slice(0, 30))).toMatchObject({ orientation: 1 });
    expect(readExif(new ArrayBuffer(0))).toMatchObject({ orientation: 1 });
  });
});
