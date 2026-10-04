import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { loadProperties, type PropertySP } from "@/lib/server/book";
import { PropertiesListView } from "@/components/accounts/properties-list-view";
import { DataLinks } from "@/components/import/data-links";
import { myActiveIds } from "@/lib/server/lists";
import { loadEditableLists, loadListGroups } from "@/lib/server/lists-index";
import { safe } from "@/lib/server/safe";
import { ListsIndex } from "@/components/lists/lists-index";
import type { PropertyTab } from "@/components/lists/property-tabs";

export const metadata: Metadata = { title: "Properties" };

async function PropertiesPageBody({ searchParams }: { searchParams: Promise<PropertySP> }) {
  const sp = await searchParams;
  const c = await ctx();
  const f = { tenant: c.tenantId, user: c.s.userId };
  const active = await safe(() => myActiveIds(c), [], "properties:active", f);
  // Reps land on what they're working when they have anything active; managers (and reps with nothing) on All.
  const tab: PropertyTab = sp.tab === "active" || sp.tab === "lists" || sp.tab === "all" ? sp.tab : !c.s.isManager && active.length ? "active" : "all";
  const activeIds = new Set(active.map((a) => a.property_id));

  if (tab === "lists") {
    const groups = await safe(() => loadListGroups(c), [], "properties:lists", f);
    return <PropertiesListView sp={sp} rows={[]} cities={[]} today={c.today} tab="lists" activeCount={active.length} listsPanel={<ListsIndex groups={groups} />} />;
  }

  const [{ rows, error, capped, cities, markets }, lists] = await Promise.all([
    loadProperties(c, sp, tab === "active" ? { ids: [...activeIds] } : {}),
    sp.select === "1" ? safe(() => loadEditableLists(c), [], "properties:editable-lists", f) : Promise.resolve([]),
  ]);
  return (
    <PropertiesListView
      sp={tab === "active" || sp.tab ? { ...sp, tab } : sp}
      rows={rows}
      cities={cities}
      markets={markets}
      today={c.today}
      error={error}
      capped={capped}
      tab={tab}
      activeCount={active.length}
      activeIds={activeIds}
      lists={lists}
      isManager={c.s.isManager}
      headerExtra={c.s.isManager ? <DataLinks entity="properties" sp={sp} /> : null}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function PropertiesPage(props: Parameters<typeof PropertiesPageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return pageBody(() => PropertiesPageBody(props), key);
}
