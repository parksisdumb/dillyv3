import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { loadProperties, type PropertySP } from "@/lib/server/book";
import { PropertiesListView } from "@/components/accounts/properties-list-view";
import { DataLinks } from "@/components/import/data-links";

export const metadata: Metadata = { title: "Properties" };

async function PropertiesPageBody({ searchParams }: { searchParams: Promise<PropertySP> }) {
  const sp = await searchParams;
  const c = await ctx();
  const { rows, error, capped, cities, markets } = await loadProperties(c, sp);
  return (
    <PropertiesListView
      sp={sp}
      rows={rows}
      cities={cities}
      markets={markets}
      today={c.today}
      error={error}
      capped={capped}
      headerExtra={c.s.isManager ? <DataLinks entity="properties" sp={sp} /> : null}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function PropertiesPage(props: Parameters<typeof PropertiesPageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return pageBody(() => PropertiesPageBody(props), key);
}
