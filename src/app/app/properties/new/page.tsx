import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { PageHeader } from "@/components/ui/bits";
import { PropertyForm } from "@/components/accounts/forms";

export const metadata: Metadata = { title: "New property" };

export default async function NewPropertyPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const { sb, tenantId } = await ctx();
  const a =
    account && /^[0-9a-f-]{36}$/i.test(account)
      ? (await sb.from("account").select("id,name,city,state").eq("tenant_id", tenantId).eq("id", account).maybeSingle()).data
      : null;
  return (
    <div>
      <PageHeader back="/app/properties" title="New property" sub="Address first — we check for the same building before saving." />
      <PropertyForm p={{ city: a?.city, state: a?.state }} account={a ? { id: a.id, label: a.name, sub: a.city } : null} />
    </div>
  );
}
