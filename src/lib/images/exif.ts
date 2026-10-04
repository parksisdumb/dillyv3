// Minimal JPEG EXIF reader (pure): orientation, capture time and GPS. We READ GPS only to offer it as the photo's
// location when the rep allows it — the re-encoded JPEG we upload never carries any EXIF (canvas strips it all).

export type ExifInfo = { orientation: number; takenAt: string | null; lat: number | null; lng: number | null };

const EMPTY: ExifInfo = { orientation: 1, takenAt: null, lat: null, lng: null };

export function readExif(buf: ArrayBuffer): ExifInfo {
  try {
    return parse(new DataView(buf));
  } catch {
    return { ...EMPTY };
  }
}

function parse(v: DataView): ExifInfo {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return { ...EMPTY };
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) break;
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
      return parseTiff(v, off + 10, Math.min(v.byteLength, off + 2 + size));
    }
    if (marker === 0xffda) break; // start of scan: no more metadata
    off += 2 + size;
  }
  return { ...EMPTY };
}

type Entry = { tag: number; type: number; count: number; valueOff: number };

function parseTiff(v: DataView, start: number, end: number): ExifInfo {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, little);
  const u32 = (o: number) => v.getUint32(o, little);
  if (u16(start + 2) !== 42) return { ...EMPTY };

  const readIfd = (rel: number): Map<number, Entry> => {
    const out = new Map<number, Entry>();
    const at = start + rel;
    if (rel <= 0 || at + 2 > end) return out;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > end) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const unit = type === 3 ? 2 : type === 4 || type === 9 ? 4 : type === 5 || type === 10 ? 8 : 1;
      const valueOff = unit * count <= 4 ? e + 8 : start + u32(e + 8);
      out.set(u16(e), { tag: u16(e), type, count, valueOff });
    }
    return out;
  };
  const ascii = (en: Entry | undefined) => {
    if (!en || en.valueOff + en.count > end) return null;
    let s = "";
    for (let i = 0; i < en.count; i++) {
      const c = v.getUint8(en.valueOff + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const rationals = (en: Entry | undefined, n: number) => {
    if (!en || en.type !== 5 || en.count < n || en.valueOff + 8 * n > end) return null;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const den = u32(en.valueOff + 8 * i + 4);
      out.push(den ? u32(en.valueOff + 8 * i) / den : 0);
    }
    return out;
  };

  const ifd0 = readIfd(u32(start + 4));
  const o = ifd0.get(0x0112);
  const orientation = o && o.type === 3 ? u16(o.valueOff) : 1;

  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr ? readIfd(u32(exifPtr.valueOff)) : new Map<number, Entry>();
  const dt = ascii(exif.get(0x9003)) ?? ascii(ifd0.get(0x0132));
  const m = dt?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  // EXIF time has no zone: interpret as the phone's local time.
  const takenAt = m ? safeIso(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;

  let lat: number | null = null;
  let lng: number | null = null;
  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const gps = readIfd(u32(gpsPtr.valueOff));
    const la = rationals(gps.get(0x0002), 3);
    const lo = rationals(gps.get(0x0004), 3);
    if (la && lo) {
      lat = (la[0] + la[1] / 60 + la[2] / 3600) * (ascii(gps.get(0x0001)) === "S" ? -1 : 1);
      lng = (lo[0] + lo[1] / 60 + lo[2] / 3600) * (ascii(gps.get(0x0003)) === "W" ? -1 : 1);
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || (lat === 0 && lng === 0)) lat = lng = null;
    }
  }
  return { orientation: orientation >= 1 && orientation <= 8 ? orientation : 1, takenAt, lat, lng };
}

function safeIso(d: Date): string | null {
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
