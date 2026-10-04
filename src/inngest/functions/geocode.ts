import { cron, eventType } from "inngest";
import { z } from "zod";
import { inngest } from "../client";

/**
 * Batch-geocode properties that have an address but no pin (CSV imports, migrated V2 data, edits).
 * Hourly, or on demand: { name: "dilly/geocode.requested", data: {} }.
 *
 * Rate: ≤ 5 req/s to the Census geocoder (one run at a time, requests spaced 200 ms).
 * Resumable: each batch of 25 is its own step (Inngest memoizes finished steps on retry) and progress lives in the
 * database (property.geocoded_at), so a crashed or timed-out run picks up exactly where it stopped. A run handles up
 * to 10 batches (~250 buildings, ~1 min) and re-queues itself if more remain.
 */
export const geocodeRequested = eventType("dilly/geocode.requested", { schema: z.object({ reason: z.string().optional() }) });

const BATCH = 25;
const BATCHES_PER_RUN = 10;

export const geocodeProperties = inngest.createFunction(
  {
    id: "geocode-properties",
    name: "Geocode properties (US Census)",
    triggers: [cron("23 * * * *"), geocodeRequested],
    concurrency: [{ limit: 1 }],
    singleton: { mode: "skip" },
    retries: 2,
  },
  async ({ step }) => {
    const { geocoderEnabled } = await import("@/lib/geo/geocode-server");
    if (!geocoderEnabled()) return { skipped: "disabled" };
    const totals = { ok: 0, nomatch: 0, error: 0, skipped: 0, batches: 0 };
    for (let b = 0; b < BATCHES_PER_RUN; b++) {
      const r = await step.run(`batch-${b}`, async () => {
        const { geocodeDb, geocodeRows, nextGeocodeBatch } = await import("@/lib/geo/geocode-server");
        const db = await geocodeDb();
        if (!db) return { n: 0, ok: 0, nomatch: 0, error: 0, skipped: 0 };
        const rows = await nextGeocodeBatch(db, BATCH);
        if (!rows.length) return { n: 0, ok: 0, nomatch: 0, error: 0, skipped: 0 };
        return { n: rows.length, ...(await geocodeRows(db, rows)) };
      });
      totals.ok += r.ok;
      totals.nomatch += r.nomatch;
      totals.error += r.error;
      totals.skipped += r.skipped;
      totals.batches++;
      if (r.n < BATCH) return { ...totals, more: false };
    }
    await step.sendEvent("continue", geocodeRequested.create({ reason: "continue" }));
    return { ...totals, more: true };
  },
);
