import { Suspense } from "react";
import RouteSkeleton from "./skeleton";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { loadProperties, type PropertySP } from "@/lib/server/book";
import { PropertiesListView } from "@/components/accounts/properties-list-view";

export const metadata: Metadata = { title: "Properties" };

async function PropertiesPageBody({ searchParams }: { searchParams: Promise<PropertySP> }) {
  const sp = await searchParams;
  const c = await ctx();
  const { rows, error, capped, cities } = await loadProperties(c, sp);
  return <PropertiesListView sp={sp} rows={rows} cities={cities} today={c.today} error={error} capped={capped} />;
}

// Skeleton in the page's own Suspense, not a route loading.tsx: a loading.tsx boundary made same-screen navigations
// (filters, scope, saves) intermittently never commit. See tests/e2e/BUGS.md B9.
export default async function PropertiesPage(props: Parameters<typeof PropertiesPageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return (
    <Suspense key={key} fallback={<RouteSkeleton />}>
      <PropertiesPageBody {...props} />
    </Suspense>
  );
}
