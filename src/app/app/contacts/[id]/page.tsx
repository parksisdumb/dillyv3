import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { daysSince } from "@/lib/domain/book";
import { ContactDetailView } from "@/components/accounts/contact-detail-view";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;
  const { data: p } = await sb.from("contact").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!p) notFound();
  const [acct, links, tasks, opps, touches] = await Promise.all([
    p.account_id ? sb.from("account").select("id,name,city").eq("id", p.account_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("property_contact").select("property_id,role").eq("tenant_id", tenantId).eq("contact_id", id),
    sb.from("task").select("id,title,due_on,reason").eq("tenant_id", tenantId).eq("contact_id", id).eq("status", "open").order("due_on"),
    sb
      .from("opportunity")
      .select("id,name,stage,value_estimate,next_step,next_step_due")
      .eq("tenant_id", tenantId)
      .eq("primary_contact_id", id)
      .order("stage_changed_at", { ascending: false }),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("contact_id", id).order("occurred_at", { ascending: false }).limit(40),
  ]);
  const propIds = (links.data ?? []).map((l) => l.property_id);
  const { data: props } = propIds.length ? await sb.from("property").select("id,name,address1,city").in("id", propIds) : { data: [] };
  const pm = new Map((props ?? []).map((x) => [x.id, x]));

  return (
    <ContactDetailView
      d={{
        today,
        c: p,
        account: acct.data ? { id: acct.data.id, label: acct.data.name, sub: acct.data.city } : null,
        properties: (links.data ?? []).flatMap((l) => {
          const x = pm.get(l.property_id);
          return x ? [{ id: x.id, label: x.name || x.address1 || "Property", sub: [x.address1, x.city].filter(Boolean).join(", ") || null, role: l.role }] : [];
        }),
        tasks: tasks.data ?? [],
        opps: opps.data ?? [],
        timeline: await withNames(c, touches.data ?? []),
        daysSinceTouch: daysSince(p.last_touch_at, new Date()),
      }}
    />
  );
}
