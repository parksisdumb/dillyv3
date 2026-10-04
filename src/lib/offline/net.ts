// Is this failure "no signal" (queue it) or a real answer from the server (show it)? Pure.

/** Browser fetch failures: Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError when attempting…". */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!e) return false;
  const name = (e as { name?: string }).name ?? "";
  const msg = (e as { message?: string }).message ?? String(e);
  return (
    name === "TypeError" ||
    name === "AbortError" ||
    name === "TimeoutError" ||
    /failed to fetch|load failed|networkerror|network request failed|fetch failed|the network connection was lost|internet connection appears to be offline/i.test(msg)
  );
}

/** navigator.onLine === false is a reliable "no"; true only means "maybe" (weak signal still reads as online). */
export function definitelyOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
