import { eventType, Inngest } from "inngest";
import { z } from "zod";

/** Event + signing keys come from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY (read by the SDK). */
export const inngest = new Inngest({ id: "dilly" });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Run the Rep Daily Brief for one rep. Send manually to (re)build a brief:
 *   { name: "dilly/rep-daily-brief.requested", data: { tenantId, userId, forDate?: "YYYY-MM-DD", trigger?: "human" } }
 */
export const repDailyBriefRequested = eventType("dilly/rep-daily-brief.requested", {
  schema: z.object({
    tenantId: z.string().uuid(),
    userId: z.string().uuid(),
    forDate: isoDate.optional(),
    trigger: z.enum(["cron", "human", "event"]).optional(),
  }),
});
