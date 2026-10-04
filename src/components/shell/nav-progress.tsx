"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Navigation feedback without route/page Suspense (tests/e2e/BUGS.md B9, B10): while a same-origin navigation is in
 * flight (link tap, GET filter form, back/forward), a thin progress bar runs under the top bar and <main> is
 * aria-busy. The old screen stays put until the new one is ready — no skeleton swap, no duplicate DOM.
 * Ends when the URL the app renders changes (or after 25 s as a safety net).
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState(false);
  const target = useRef<string | null>(null);

  // Arrived: whatever we were waiting for has rendered.
  useEffect(() => {
    target.current = null;
    setPending(false);
  }, [pathname, search]);

  useEffect(() => {
    const here = () => location.pathname + location.search;
    const start = (url: URL) => {
      if (url.origin !== location.origin) return;
      const next = url.pathname + url.search;
      if (next === here()) return;
      target.current = next;
      setPending(true);
    };
    const onClick = (e: MouseEvent) => {
      // Capture phase, and no defaultPrevented check: next/link prevents the default to navigate client-side.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      try {
        start(new URL(a.href, location.href));
      } catch {
        /* not a URL */
      }
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement | null;
      if (!f || e.defaultPrevented || (f.method || "get").toLowerCase() !== "get" || typeof f.action !== "string") return;
      try {
        const url = new URL(f.action, location.href);
        url.search = new URLSearchParams(new FormData(f) as unknown as Record<string, string>).toString();
        start(url);
      } catch {
        /* ignore */
      }
    };
    const onPop = () => setPending(true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // Don't flash for fast navigations; never spin forever.
  useEffect(() => {
    if (!pending) {
      setShown(false);
      return;
    }
    const show = setTimeout(() => setShown(true), 120);
    const giveUp = setTimeout(() => setPending(false), 25_000);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    if (shown) main.setAttribute("aria-busy", "true");
    else main.removeAttribute("aria-busy");
  }, [shown]);

  if (!shown) return null;
  return (
    <div role="progressbar" aria-label="Loading" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-accent/20">
      <div className="h-full w-1/3 animate-[navbar_1.1s_ease-in-out_infinite] bg-accent motion-reduce:w-full motion-reduce:animate-none" />
    </div>
  );
}
