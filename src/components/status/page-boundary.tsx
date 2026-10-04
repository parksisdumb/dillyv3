import "server-only";
import type { ReactNode } from "react";

/**
 * A page's body: rendered in full on the server (no page-level Suspense), keyed by its params/search params so a
 * filter or record change remounts the screen's client state.
 *
 * History:
 * - B9: route-level `loading.tsx` boundaries made ~1 in 4 same-screen navigations never commit → removed.
 * - The replacement, a keyed `<Suspense fallback={skeleton}>` in each page, caused B10: React outlines any completed
 *   boundary over ~12.8 KB (Fizz `progressiveChunkSize`) into a hidden `<div id="S:n">` and reveals it with a
 *   batched `$RC`/`$RV` up to ~300 ms later, while hydration has already rendered the boundary — two copies of the
 *   whole screen in the DOM on every full page load. Every page is bigger than 12.8 KB, so there is no Suspense
 *   configuration that avoids it.
 * So pages render without a boundary at all: one copy, no streaming swap, and the same client tree for document
 * loads, client navigations, router.refresh and server-action revalidation (nothing remounts unexpectedly).
 * Navigation feedback comes from <NavProgress/> in the app shell (top progress bar + aria-busy), not skeletons.
 */
export async function pageBody(render: () => Promise<ReactNode> | ReactNode, key?: string) {
  return (
    <div key={key} className="contents">
      {await render()}
    </div>
  );
}
