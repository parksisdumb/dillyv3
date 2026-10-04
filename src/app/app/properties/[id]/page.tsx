import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { PropertyDetailView } from "@/components/accounts/property-detail-view";

export const metadata: Metadata = { title: "Property" };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;
  const { data: p } = await sb.from("property").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!p) notFound();
  const [acct, links, tasks, opps, touches] = await Promise.all([
    p.account_id ? sb.from("account").select("id,name,city").eq("id", p.account_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("property_contact").select("contact_id,role").eq("tenant_id", tenantId).eq("property_id", id),
    sb.from("task").select("id,title,due_on,reason").eq("tenant_id", tenantId).eq("property_id", id).eq("status", "open").order("due_on"),
    sb
      .from("opportunity")
      .select("id,name,stage,value_estimate,next_step,next_step_due")
      .eq("tenant_id", tenantId)
      .eq("property_id", id)
      .order("stage_changed_at", { ascending: false }),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("property_id", id).order("occurred_at", { ascending: false }).limit(40),
  ]);
  const ids = (links.data ?? []).map((l) => l.contact_id);
  const { data: people } = ids.length ? await sb.from("contact").select("id,full_name,title").in("id", ids) : { data: [] };
  const cm = new Map((people ?? []).map((x) => [x.id, x]));

  return (
    <PropertyDetailView
      d={{
        today,
        year: Number(today.slice(0, 4)),
        p: { ...p, roof_area_sf: p.roof_area_sf == null ? null : Number(p.roof_area_sf) },
        account: acct.data ? { id: acct.data.id, label: acct.data.name, sub: acct.data.city } : null,
        contacts: (links.data ?? []).flatMap((l) => {
          const x = cm.get(l.contact_id);
          return x ? [{ id: x.id, label: x.full_name ?? "Unnamed", sub: x.title, role: l.role }] : [];
        }),
        tasks: tasks.data ?? [],
        opps: opps.data ?? [],
        timeline: await withNames(c, touches.data ?? []),
        lastTouchAt: touches.data?.[0]?.occurred_at ?? null,
      }}
    />
  );
}
