import { Suspense } from "react";
import RouteSkeleton from "./skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { safe, safeData } from "@/lib/server/safe";
import { AccountDetailView } from "@/components/accounts/account-detail-view";
import { loadPastProperties, loadPropertyBadges } from "@/lib/server/ownership";

export const metadata: Metadata = { title: "Account" };

async function AccountDetailBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;

  const { data: a, error: aError } = await sb.from("account_ranked").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  // An outage is not a 404: throw to the error screen ("Try again") instead of "can't find that one".
  if (aError) throw new Error(`account ${id}: ${aError.message}`);
  if (!a) notFound();

  // The account header is the page; each section below degrades to empty on its own.
  const f = { tenant: tenantId, account: id };
  const [task, opps, props, contacts, touches, owner] = await Promise.all([
    safeData(sb.from("task").select("id,title,due_on,reason").eq("tenant_id", tenantId).eq("account_id", id).eq("status", "open").order("due_on").limit(1).maybeSingle(), null, "account:task", f),
    safeData(
      sb
        .from("opportunity")
        .select("id,name,stage,value_estimate,next_step,next_step_due,stage_changed_at")
        .eq("tenant_id", tenantId)
        .eq("account_id", id)
        .not("stage", "in", "(won,lost)")
        .order("value_estimate", { ascending: false, nullsFirst: false }),
      [],
      "account:opps",
      f,
    ),
    safeData(
      sb
        .from("property")
        .select("id,name,address1,city,state,roof_system,roof_install_year,roof_area_sf,asset_class")
        .eq("tenant_id", tenantId)
        .eq("account_id", id)
        .is("duplicate_of", null)
        .order("name"),
      [],
      "account:properties",
      f,
    ),
    safeData(
      sb
        .from("contact")
        .select("id,full_name,title,persona_role,phone,mobile,email,do_not_contact,last_touch_at")
        .eq("tenant_id", tenantId)
        .eq("account_id", id)
        .is("duplicate_of", null)
        .order("last_touch_at", { ascending: false, nullsFirst: false }),
      [],
      "account:contacts",
      f,
    ),
    safeData(sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("account_id", id).order("occurred_at", { ascending: false }).limit(40), [], "account:touches", f),
    a.owner_user_id ? safeData(sb.from("profile").select("full_name,email").eq("id", a.owner_user_id).maybeSingle(), null, "account:owner", f) : Promise.resolve(null),
  ]);

  const propIds = props.map((p) => p.id);
  const [propBadges, past, links] = await Promise.all([
    safe(() => loadPropertyBadges(c, propIds), {}, "account:badges", f),
    safe(() => loadPastProperties(c, id), [], "account:past-properties", f),
    propIds.length
      ? safeData(sb.from("property_contact").select("property_id,contact_id").eq("tenant_id", tenantId).in("property_id", propIds.slice(0, 200)), [], "account:property-links", f)
      : Promise.resolve([] as { property_id: string; contact_id: string }[]),
  ]);
  const byContact = new Map<string, string[]>();
  for (const l of links) byContact.set(l.contact_id, [...(byContact.get(l.contact_id) ?? []), l.property_id]);

  return (
    <AccountDetailView
      d={{
        id,
        today,
        a: { ...a, name: a.name ?? "Account" },
        task,
        opps,
        props: props.map((p) => ({ ...p, roof_area_sf: p.roof_area_sf == null ? null : Number(p.roof_area_sf) })),
        contacts,
        timeline: await safe(() => withNames(c, touches), [], "account:timeline-names", f),
        ownerName: owner?.full_name ?? owner?.email ?? null,
        propBadges,
        past,
        movePeople: contacts
          .filter((p) => byContact.has(p.id))
          .map((p) => ({ id: p.id, name: p.full_name ?? "Unnamed", title: p.title, persona_role: p.persona_role, account_id: id, propertyIds: byContact.get(p.id) ?? [] })),
      }}
    />
  );
}

// Skeleton in the page's own Suspense, not a route loading.tsx: a loading.tsx boundary made same-screen navigations
// (filters, scope, saves) intermittently never commit. See tests/e2e/BUGS.md B9.
export default async function AccountDetail(props: Parameters<typeof AccountDetailBody>[0]) {
  const key = JSON.stringify(await props.params);
  return (
    <Suspense key={key} fallback={<RouteSkeleton />}>
      <AccountDetailBody {...props} />
    </Suspense>
  );
}
