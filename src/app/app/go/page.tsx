import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import Link from "next/link";
import { ctx, type Ctx } from "@/lib/server/ctx";
import { safe } from "@/lib/server/safe";
import { mergePointRules } from "@/lib/domain/points";
import { dayStartISO, mapsUrl, quietLabel } from "@/lib/format";
import { CityChips } from "@/components/go/go-chrome";
import { FocusSession } from "@/components/go/focus-session";
import { MyDay } from "@/components/go/my-day";
import { stopKey, type DayStop, type FocusItem, type Stop } from "@/components/go/types";
import type { QueueRow } from "@/components/today/queue-item";
import { propertyBadges } from "@/lib/domain/badges-property";
import { OUTCOMES, type Outcome } from "@/lib/domain/vocab";
import { after } from "next/server";
import { geocodeSoon } from "@/lib/geo/geocode-server";
import { loadMyAppointments } from "@/lib/server/appointments";
import { nearestNeighborOrder, hasCoords } from "@/lib/geo/route";
import { PageHeader } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { IconChevronLeft, IconPlus } from "@/components/icons";
import { ScheduleButton } from "@/components/appointments/appt-card";
import { getMyWorkingListStops, toGoStop } from "@/lib/lists/working-list";

export const metadata: Metadata = { title: "My day" };

const MAX_STOPS = 15;

/**
 * The rep's working list (assigned lists + active pursuits) from src/lib/lists/working-list.ts. Today's appointment
 * buildings are excluded (they show in the appointment section). Empty or failing → Go falls back to its own
 * suggestions (queue accounts, then my best assigned accounts, grouped by city).
 */
async function workingListStops(c: Ctx, exclude: string[]): Promise<{ stops: DayStop[]; names: string[] } | null> {
  const rows = await getMyWorkingListStops(c.tenantId, c.s.userId, { excludePropertyIds: exclude });
  if (!rows.length) return null;
  const stops = rows.map((w) => {
    const st = toGoStop(w);
    return { ...st, key: stopKey(st), listName: w.listName } satisfies DayStop;
  });
  return { stops, names: [...new Set(rows.map((w) => w.listName ?? "Active buildings"))] };
}

/** The pre-lists Go source: queue accounts first, then my best assigned accounts, in one city at a time. */
async function suggestedStops(c: Ctx, queue: QueueRow[], city: string | undefined) {
  const { sb, s, tenantId } = c;
  const { data: mine } = await sb
    .from("account_ranked")
    .select("id,name,icp_tier,city,state,address1,relationship_state,days_since_touch,last_touch_at,rank_score")
    .eq("tenant_id", tenantId)
    .eq("owner_user_id", s.userId)
    .eq("is_test", false)
    .not("relationship_state", "in", "(excluded,do_not_pursue)")
    .order("rank_score", { ascending: false, nullsFirst: false })
    .limit(80);
  const queueByAcct = new Map<string, QueueRow>();
  for (const q of queue) if (q.account_id && !queueByAcct.has(q.account_id)) queueByAcct.set(q.account_id, q);
  const ids = [...new Set([...queueByAcct.keys(), ...(mine ?? []).map((m) => m.id).filter((x): x is string => !!x)])];
  const [acctRes, propRes] = ids.length
    ? await Promise.all([
        sb.from("account").select("id,name,icp_tier,city,state,address1").in("id", ids),
        sb.from("property").select("id,account_id,name,address1,city,state,lat,lng,geocoded_at").eq("tenant_id", tenantId).in("account_id", ids).is("duplicate_of", null),
      ])
    : [{ data: [] }, { data: [] }];
  const acctMap = new Map((acctRes.data ?? []).map((a) => [a.id, a]));
  const mineMap = new Map((mine ?? []).map((m) => [m.id, m]));
  const all: Stop[] = ids.flatMap((id) => {
    const a = acctMap.get(id);
    if (!a) return [];
    const prop = (propRes.data ?? []).find((p) => p.account_id === id && (p.address1 || p.city));
    const q = queueByAcct.get(id);
    const m = mineMap.get(id);
    const address = prop?.address1 ?? a.address1;
    return [
      {
        accountId: id,
        accountName: a.name,
        tier: a.icp_tier,
        propertyId: prop?.id ?? null,
        place: prop?.name ?? null,
        address,
        city: prop?.city ?? a.city ?? "No address",
        reason: q ? q.title ?? q.reason : m ? `P${m.icp_tier} · ${quietLabel(m.days_since_touch, m.last_touch_at)}` : null,
        directions: mapsUrl([address, prop?.city ?? a.city, prop?.state ?? a.state]),
        lat: prop?.lat == null ? null : Number(prop.lat),
        lng: prop?.lng == null ? null : Number(prop.lng),
        mapsAddress: [address, prop?.city ?? a.city, prop?.state ?? a.state].filter(Boolean).join(", ") || null,
        contacts: [],
        fromQueue: !!q,
      },
    ];
  });
  const cities = [...new Set(all.map((x) => x.city))]
    .map((ct) => ({ city: ct, total: all.filter((x) => x.city === ct).length, due: all.filter((x) => x.city === ct && x.fromQueue).length }))
    .sort((a, b) => b.due - a.due || b.total - a.total || a.city.localeCompare(b.city));
  const picked = city && cities.some((x) => x.city === city) ? city : cities[0]?.city;
  const stops = all
    .filter((x) => x.city === picked)
    .sort((a, b) => Number(b.fromQueue) - Number(a.fromQueue) || (a.tier ?? 3) - (b.tier ?? 3) || (a.address ?? "").localeCompare(b.address ?? ""))
    .slice(0, MAX_STOPS);
  const tried = new Set((propRes.data ?? []).filter((p) => p.geocoded_at).map((p) => p.id));
  return { stops: stops.map((st) => ({ ...st, key: stopKey(st) })) as DayStop[], cities, city: picked, tried };
}

/** People per account (Log-with chips), badges/flags per building, and what I already logged today. */
async function enrich(c: Ctx, stops: DayStop[]) {
  const { sb, tenantId, s, today } = c;
  const acctIds = [...new Set(stops.map((x) => x.accountId).filter(Boolean))];
  const propIds = stops.map((x) => x.propertyId).filter((x): x is string => !!x);
  const since = dayStartISO(today, s.tenant.timezone);
  const [people, cur, touches] = await Promise.all([
    acctIds.length
      ? sb.from("contact").select("id,account_id,full_name,title,persona_role").eq("tenant_id", tenantId).in("account_id", acctIds).eq("do_not_contact", false).is("duplicate_of", null).limit(400)
      : Promise.resolve({ data: [] as { id: string; account_id: string | null; full_name: string | null; title: string | null; persona_role: string }[] }),
    propIds.length
      ? sb
          .from("property_current")
          .select("id,roof_system,roof_install_year,warranty_expires_on,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at")
          .in("id", propIds)
      : Promise.resolve({ data: [] }),
    sb.from("touch").select("account_id,property_id,outcome,occurred_at").eq("tenant_id", tenantId).eq("user_id", s.userId).is("voided_at", null).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(200),
  ]);
  const byProp = new Map((cur.data ?? []).map((r) => [r.id, r]));
  for (const st of stops) {
    if (st.contacts.length === 0)
      st.contacts = (people.data ?? []).filter((p) => p.account_id === st.accountId).map((p) => ({ id: p.id, name: p.full_name ?? "Unnamed", title: p.title, role: p.persona_role }));
    const r = st.propertyId ? byProp.get(st.propertyId) : undefined;
    if (r && !st.badges) {
      st.badges = propertyBadges(r, today);
      st.flags = r.active_flags ?? [];
    }
    const t = (touches.data ?? []).find((x) => (st.propertyId ? x.property_id === st.propertyId : x.account_id === st.accountId));
    st.logged = t ? OUTCOMES[t.outcome as Outcome]?.label ?? "Logged" : null;
  }
  return stops;
}

/** Calls through the list: each stop's best person with a number (else the main line), then the queue's numbers. */
async function callItems(c: Ctx, stops: DayStop[], queue: QueueRow[]): Promise<FocusItem[]> {
  const { sb, tenantId } = c;
  const acctIds = [...new Set(stops.map((x) => x.accountId).filter(Boolean))];
  const [people, accts] = acctIds.length
    ? await Promise.all([
        sb.from("contact").select("id,account_id,full_name,phone,mobile,last_touch_at").eq("tenant_id", tenantId).in("account_id", acctIds).eq("do_not_contact", false).is("duplicate_of", null).limit(400),
        sb.from("account").select("id,name,phone,icp_tier").in("id", acctIds),
      ])
    : [{ data: [] }, { data: [] }];
  const items: FocusItem[] = [];
  const seen = new Set<string>();
  for (const st of stops) {
    const p = (people.data ?? []).find((x) => x.account_id === st.accountId && (x.mobile || x.phone));
    const a = (accts.data ?? []).find((x) => x.id === st.accountId);
    const phone = p ? p.mobile ?? p.phone : a?.phone;
    const key = p?.id ?? st.accountId;
    if (!phone || !key || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, accountId: st.accountId || null, contactId: p?.id ?? null, propertyId: st.propertyId, opportunityId: null, name: p?.full_name ?? st.accountName, account: p ? st.accountName : null, phone, reason: st.reason, tier: st.tier });
  }
  for (const q of queue) {
    if (!q.phone) continue;
    const key = q.contact_id ?? q.account_id ?? q.task_id ?? String(items.length);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, accountId: q.account_id, contactId: q.contact_id, propertyId: q.property_id, opportunityId: q.opportunity_id, name: q.contact_name ?? q.account_name ?? "Main line", account: q.contact_name ? q.account_name : null, phone: q.phone, reason: q.title ?? q.reason, tier: q.icp_tier });
  }
  return items;
}

async function GoPageBody({ searchParams }: { searchParams: Promise<{ mode?: string; city?: string }> }) {
  const sp = await searchParams;
  const calls = sp.mode === "calls" || sp.mode === "focus";
  const c = await ctx();
  const { sb, s, tenantId } = c;
  const f = { tenant: tenantId, user: s.userId };

  const [appointments, queueRes, rulesRes] = await Promise.all([
    safe(() => loadMyAppointments(c), { today: [], upcoming: [], overdue: [] }, "go:appointments", f),
    sb.rpc("rep_queue", { p_tenant: tenantId, p_user: s.userId }),
    sb.from("point_rule").select("tenant_id,event,points").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
  ]);
  const queue = (queueRes.data ?? []) as QueueRow[];
  const apptProps = [...appointments.overdue, ...appointments.today].flatMap((a) => a.stops.map((x) => x.propertyId));

  const working = await safe(() => workingListStops(c, apptProps), null, "go:working-list", f);
  const fallback = working ? null : await suggestedStops(c, queue, sp.city);
  let stops = working?.stops ?? (fallback?.stops ?? []).filter((x) => !x.propertyId || !apptProps.includes(x.propertyId));
  // Route order: nearest-neighbour from the last appointment building with a pin (or the first stop).
  const lastAppt = appointments.today.flatMap((a) => a.stops).filter((x) => hasCoords(x)).at(-1);
  const located = stops.map((x) => ({ ...x, id: x.key, label: x.accountName, lat: x.lat ?? null, lng: x.lng ?? null }));
  stops = nearestNeighborOrder(located, lastAppt ? { lat: lastAppt.lat!, lng: lastAppt.lng! } : null);
  stops = await safe(() => enrich(c, stops), stops, "go:enrich", f);

  // Buildings without a map pin: geocode after the response so Route has them next time.
  const toGeocode = stops.filter((x) => x.propertyId && x.lat == null && !fallback?.tried.has(x.propertyId)).map((x) => x.propertyId!);
  if (toGeocode.length) after(() => geocodeSoon(toGeocode));

  if (calls) {
    return (
      <div>
        <PageHeader
          title="Call through the list"
          action={
            <Link href="/app/go" className={btn("secondary", "md", "shrink-0")}>
              <IconChevronLeft size={18} /> My day
            </Link>
          }
        />
        <FocusSession items={await callItems(c, stops, queue)} points={mergePointRules(rulesRes.data ?? [])} />
      </div>
    );
  }

  const listTitle = working ? (working.names.length === 1 ? working.names[0] : "My working list") : `Suggested stops${fallback?.city ? ` · ${fallback.city}` : ""}`;
  return (
    <div>
      <PageHeader
        title="My day"
        action={
          <div className="flex shrink-0 gap-2">
            <ScheduleButton target={{}} label="Schedule" size="md" />
            <Link href="/app/contacts/new?source=field&back=/app/go" className={btn("secondary", "md", "shrink-0")} aria-label="Add a person I met">
              <IconPlus size={18} /> Person
            </Link>
          </div>
        }
      />
      {fallback && fallback.cities.length > 1 && <CityChips cities={fallback.cities} city={fallback.city} />}
      <MyDay
        key={`${fallback?.city ?? "list"}`}
        appointments={appointments}
        stops={stops}
        listTitle={listTitle}
        listHint={fallback ? "Your queue and best assigned accounts with an address. Tap Log at a stop — pick in person, call or email in the sheet." : null}
        callHref="/app/go?mode=calls"
      />
    </div>
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function GoPage(props: Parameters<typeof GoPageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return pageBody(() => GoPageBody(props), key);
}
