// "Mark <building> active?" after a log. A plain GET (not a server action) so it never races the Log sheet's
// router.refresh(): a server action in flight would replace the refreshed screen with its own render.
import { pursuitHint } from "@/lib/actions/lists";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("property") ?? "";
  const hint = await pursuitHint(id);
  return Response.json(hint, { headers: { "cache-control": "no-store" } });
}
