import { Suspense } from "react";
import RouteSkeleton from "./skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { loadPartyHistory } from "@/lib/server/ownership";
import { PropertyDetailView } from "@/components/accounts/property-detail-view";
import { loadPropertyPhotos } from "@/lib/server/photos";

export const metadata: Metadata = { title: "Property" };

async function PropertyPageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;
  const { data: p } = await sb.from("property_current").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!p || !p.id) notFound();
  const [acct, links, tasks, opps, touches, touchCount, history, photos] = await Promise.all([
    p.account_id ? sb.from("account").select("id,name,city").eq("id", p.account_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("property_contact").select("contact_id,role").eq("tenant_id", tenantId).eq("property_id", id),
    sb.from("task").select("id,title,due_on,reason").eq("tenant_id", tenantId).eq("property_id", id).eq("status", "open").order("due_on"),
    sb
      .from("opportunity")
      .select("id,name,stage,value_estimate,next_step,next_step_due,service_line,account_id")
      .eq("tenant_id", tenantId)
      .eq("property_id", id)
      .order("stage_changed_at", { ascending: false }),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("property_id", id).order("occurred_at", { ascending: false }).limit(40),
    sb.from("touch").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("property_id", id).is("voided_at", null),
    loadPartyHistory(c, { propertyId: id }),
    loadPropertyPhotos(c, id).catch(() => []),
  ]);
  const ids = (links.data ?? []).map((l) => l.contact_id);
  const { data: people } = ids.length ? await sb.from("contact").select("id,full_name,title,persona_role,account_id").in("id", ids) : { data: [] };
  const cm = new Map((people ?? []).map((x) => [x.id, x]));
  const name = p.name || p.address1 || "Property";

  return (
    <PropertyDetailView
      d={{
        today,
        year: Number(today.slice(0, 4)),
        p: {
          id: p.id,
          account_id: p.account_id,
          name: p.name,
          address1: p.address1,
          city: p.city,
          state: p.state,
          zip: p.zip,
          asset_class: p.asset_class,
          roof_system: p.roof_system,
          roof_area_sf: p.roof_area_sf == null ? null : Number(p.roof_area_sf),
          roof_install_year: p.roof_install_year,
          warranty_expires_on: p.warranty_expires_on,
          building_count: p.building_count,
          notes: p.notes,
        },
        account: acct.data ? { id: acct.data.id, label: acct.data.name, sub: acct.data.city } : null,
        contacts: (links.data ?? []).flatMap((l) => {
          const x = cm.get(l.contact_id);
          return x ? [{ id: x.id, label: x.full_name ?? "Unnamed", sub: x.title, role: l.role }] : [];
        }),
        tasks: tasks.data ?? [],
        opps: opps.data ?? [],
        timeline: await withNames(c, touches.data ?? []),
        lastTouchAt: touches.data?.[0]?.occurred_at ?? null,
        photos,
        badge: {
          active_flags: p.active_flags,
          open_service_lines: p.open_service_lines,
          management_changed_on: p.management_changed_on,
          ownership_changed_on: p.ownership_changed_on,
          storm_kind: p.storm_kind,
          storm_at: p.storm_at,
        },
        ownership: {
          propertyId: p.id,
          propertyName: name,
          accountId: p.account_id,
          today,
          history,
          people: (people ?? []).map((x) => ({ id: x.id, name: x.full_name ?? "Unnamed", title: x.title, persona_role: x.persona_role, account_id: x.account_id })),
          opps: (opps.data ?? []).map((o) => ({ id: o.id, account_id: o.account_id, stage: o.stage, value_estimate: o.value_estimate, service_line: o.service_line })),
          touches: touchCount.count ?? 0,
        },
      }}
    />
  );
}

// Skeleton in the page's own Suspense, not a route loading.tsx: a loading.tsx boundary made same-screen navigations
// (filters, scope, saves) intermittently never commit. See tests/e2e/BUGS.md B9.
export default async function PropertyPage(props: Parameters<typeof PropertyPageBody>[0]) {
  const key = JSON.stringify(await props.params);
  return (
    <Suspense key={key} fallback={<RouteSkeleton />}>
      <PropertyPageBody {...props} />
    </Suspense>
  );
}
