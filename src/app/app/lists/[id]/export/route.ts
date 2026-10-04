// A list as CSV (anyone who can open the list). Same streaming shape as /app/export/<kind>; one page of rows.
import { ctx } from "@/lib/server/ctx";
import { listRows, loadList } from "@/lib/server/lists";
import { csvLine } from "@/lib/domain/import/parse";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx();
  const list = await loadList(c, id);
  if (!list) return new Response("Not found", { status: 404 });
  const { rows } = await listRows(c, list, {}, 5000);
  const header = ["Name", "Address", "City", "State", "Account", "Manager", "Owner", "Roof system", "Roof install year", "Warranty expires", "Last touch", "Badges", "Dilly id"];
  const body = rows.map((r) =>
    csvLine([
      r.name,
      r.address,
      r.city,
      r.state ?? "",
      r.account_name,
      r.manager_name ?? "",
      r.owner_name ?? "",
      r.roof_system,
      r.roof_install_year,
      r.warranty_expires_on,
      r.last_touch_at ? r.last_touch_at.slice(0, 10) : "",
      (r.badges ?? []).map((b) => b.label),
      r.id,
    ]),
  );
  const slug = list.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "list";
  return new Response("﻿" + csvLine(header) + body.join(""), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${c.s.tenant.slug}-${slug}-${c.today}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
