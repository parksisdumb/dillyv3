import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { daysSince } from "@/lib/domain/book";
import { ContactDetailView } from "@/components/accounts/contact-detail-view";
import { loadEmployment } from "@/lib/server/ownership";

export const metadata: Metadata = { title: "Contact" };

async function ContactPageBody({ params }: { params: Promise<{ id: string }> }) {
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
  const [{ data: props }, employment, touchCount] = await Promise.all([
    propIds.length ? sb.from("property").select("id,name,address1,city,account_id").in("id", propIds) : Promise.resolve({ data: [] as { id: string; name: string | null; address1: string | null; city: string | null; account_id: string | null }[] }),
    loadEmployment(c, id),
    sb.from("touch").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("contact_id", id).is("voided_at", null),
  ]);
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
        employment,
        touchCount: touchCount.count ?? 0,
        oldCompanyBuildings: p.account_id ? (props ?? []).filter((x) => x.account_id === p.account_id).length : 0,
      }}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function ContactPage(props: Parameters<typeof ContactPageBody>[0]) {
  const key = JSON.stringify(await props.params);
  return pageBody(() => ContactPageBody(props), key);
}
