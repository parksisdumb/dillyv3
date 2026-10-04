import { Suspense } from "react";
import RouteSkeleton from "./skeleton";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { mergePointRules } from "@/lib/domain/points";
import { mapsUrl, quietLabel } from "@/lib/format";
import { CityChips, GoHeader } from "@/components/go/go-chrome";
import { FieldSession } from "@/components/go/field-session";
import { FocusSession } from "@/components/go/focus-session";
import type { FocusItem, Stop } from "@/components/go/types";
import type { QueueRow } from "@/components/today/queue-item";
import { propertyBadges } from "@/lib/domain/badges-property";

export const metadata: Metadata = { title: "Go" };

const MAX_STOPS = 15;

async function GoPageBody({ searchParams }: { searchParams: Promise<{ mode?: string; city?: string }> }) {
  const sp = await searchParams;
  const mode = sp.mode === "focus" ? "focus" : "field";
  const c = await ctx();
  const { sb, s, tenantId } = c;

  const [queueRes, mineRes, rulesRes] = await Promise.all([
    sb.rpc("rep_queue", { p_tenant: tenantId, p_user: s.userId }),
    sb
      .from("account_ranked")
      .select("id,name,icp_tier,city,state,address1,relationship_state,days_since_touch,last_touch_at,rank_score")
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", s.userId)
      .eq("is_test", false)
      .not("relationship_state", "in", "(excluded,do_not_pursue)")
      .order("rank_score", { ascending: false, nullsFirst: false })
      .limit(80),
    sb.from("point_rule").select("tenant_id,event,points").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
  ]);
  const queue = (queueRes.data ?? []) as QueueRow[];
  const points = mergePointRules(rulesRes.data ?? []);

  if (mode === "focus") {
    const seen = new Set<string>();
    const items: FocusItem[] = [];
    for (const q of queue) {
      if (!q.phone) continue;
      const key = q.contact_id ?? q.account_id ?? q.task_id ?? String(items.length);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        key,
        accountId: q.account_id,
        contactId: q.contact_id,
        propertyId: q.property_id,
        opportunityId: q.opportunity_id,
        name: q.contact_name ?? q.account_name ?? "Main line",
        account: q.contact_name ? q.account_name : null,
        phone: q.phone,
        reason: q.title ?? q.reason,
        tier: q.icp_tier,
      });
    }
    return (
      <div>
        <GoHeader mode={mode} />
        <FocusSession items={items} points={points} />
      </div>
    );
  }

  // Field session: queue accounts first, then my best assigned accounts, grouped by city.
  const mine = mineRes.data ?? [];
  const queueByAcct = new Map<string, QueueRow>();
  for (const q of queue) if (q.account_id && !queueByAcct.has(q.account_id)) queueByAcct.set(q.account_id, q);
  const ids = [...new Set([...queueByAcct.keys(), ...mine.map((m) => m.id).filter((x): x is string => !!x)])];

  const [acctRes, propRes, peopleRes] = ids.length
    ? await Promise.all([
        sb.from("account").select("id,name,icp_tier,city,state,address1").in("id", ids),
        sb.from("property").select("id,account_id,name,address1,city,state").eq("tenant_id", tenantId).in("account_id", ids).is("duplicate_of", null),
        sb
          .from("contact")
          .select("id,account_id,full_name,title,persona_role")
          .eq("tenant_id", tenantId)
          .in("account_id", ids)
          .eq("do_not_contact", false)
          .is("duplicate_of", null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const acctMap = new Map((acctRes.data ?? []).map((a) => [a.id, a]));
  const mineMap = new Map(mine.map((m) => [m.id, m]));
  const stops: Stop[] = ids.flatMap((id) => {
    const a = acctMap.get(id);
    if (!a) return [];
    const prop = (propRes.data ?? []).find((p) => p.account_id === id && (p.address1 || p.city));
    const q = queueByAcct.get(id);
    const m = mineMap.get(id);
    const address = prop?.address1 ?? a.address1;
    const city = prop?.city ?? a.city ?? "No address";
    return [
      {
        accountId: id,
        accountName: a.name,
        tier: a.icp_tier,
        propertyId: prop?.id ?? null,
        place: prop?.name ?? null,
        address,
        city,
        reason: q ? q.title ?? q.reason : m ? `P${m.icp_tier} · ${quietLabel(m.days_since_touch, m.last_touch_at)}` : null,
        directions: mapsUrl([address, prop?.city ?? a.city, prop?.state ?? a.state]),
        contacts: (peopleRes.data ?? [])
          .filter((p) => p.account_id === id)
          .map((p) => ({ id: p.id, name: p.full_name ?? "Unnamed", title: p.title, role: p.persona_role })),
        fromQueue: !!q,
      },
    ];
  });

  const cities = [...new Set(stops.map((x) => x.city))]
    .map((c) => ({ city: c, total: stops.filter((x) => x.city === c).length, due: stops.filter((x) => x.city === c && x.fromQueue).length }))
    .sort((a, b) => b.due - a.due || b.total - a.total || a.city.localeCompare(b.city));
  const city = sp.city && cities.some((c) => c.city === sp.city) ? sp.city : cities[0]?.city;
  const todays = stops
    .filter((x) => x.city === city)
    .sort((a, b) => Number(b.fromQueue) - Number(a.fromQueue) || (a.tier ?? 3) - (b.tier ?? 3) || (a.address ?? "").localeCompare(b.address ?? ""))
    .slice(0, MAX_STOPS);

  // Badges + condition flags for today's buildings (the field is where reps see and set them).
  const propIds = todays.map((x) => x.propertyId).filter((x): x is string => !!x);
  if (propIds.length) {
    const { data: cur } = await sb
      .from("property_current")
      .select("id,roof_system,roof_install_year,warranty_expires_on,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at")
      .in("id", propIds);
    const byId = new Map((cur ?? []).map((r) => [r.id, r]));
    for (const st of todays) {
      const r = st.propertyId ? byId.get(st.propertyId) : undefined;
      if (r) {
        st.badges = propertyBadges(r, c.today);
        st.flags = r.active_flags ?? [];
      }
    }
  }

  return (
    <div>
      <GoHeader mode={mode} />
      <CityChips cities={cities} city={city} />
      <FieldSession key={city ?? "none"} stops={todays} points={points} />
    </div>
  );
}

// Skeleton in the page's own Suspense, not a route loading.tsx: a loading.tsx boundary made same-screen navigations
// (filters, scope, saves) intermittently never commit. See tests/e2e/BUGS.md B9.
export default async function GoPage(props: Parameters<typeof GoPageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return (
    <Suspense key={key} fallback={<RouteSkeleton />}>
      <GoPageBody {...props} />
    </Suspense>
  );
}
