import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { loadProperties, type PropertySP } from "@/lib/server/book";
import { PropertiesListView } from "@/components/accounts/properties-list-view";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<PropertySP> }) {
  const sp = await searchParams;
  const c = await ctx();
  const { rows, error, capped, cities } = await loadProperties(c, sp);
  return <PropertiesListView sp={sp} rows={rows} cities={cities} today={c.today} error={error} capped={capped} />;
}
