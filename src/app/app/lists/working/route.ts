// The signed-in rep's working list (what Go walks: active pursuits, then assigned lists) as JSON.
// Used for support/debugging and by the end-to-end suite; Go itself calls getMyWorkingListStops directly.
import { ctx } from "@/lib/server/ctx";
import { getMyWorkingListStops } from "@/lib/lists/working-list";

export const dynamic = "force-dynamic";

export async function GET() {
  const c = await ctx();
  const stops = await getMyWorkingListStops(c.tenantId, c.s.userId);
  return Response.json(
    { stops: stops.map((s) => ({ propertyId: s.propertyId, name: s.name, source: s.source, listName: s.listName, reason: s.reason, stale: s.stale })) },
    { headers: { "cache-control": "no-store" } },
  );
}
