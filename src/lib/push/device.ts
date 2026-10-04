/** "iPhone · Safari", "Android · Chrome", "Mac · Chrome" — from a stored user agent. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "Device";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : null;
  return browser ? `${os} · ${browser}` : os;
}

/** "19:00" → "7 PM", "07:30" → "7:30 AM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

/** iPhone/iPad Safari, not already running from the home screen (where the install hint makes sense). */
export function shouldShowInstallHint(nav: { userAgent: string; maxTouchPoints?: number; standalone?: boolean }, standaloneMedia: boolean): boolean {
  const ua = nav.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  return iOS && safari && !nav.standalone && !standaloneMedia;
}
