import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { PageHeader } from "@/components/ui/bits";
import { OpportunityForm } from "@/components/pipeline/opp-forms";
import { loadOppOptions } from "@/components/pipeline/load-options";
import { addDays } from "@/lib/format";

export const metadata: Metadata = { title: "New opportunity" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NewOpportunity({ searchParams }: { searchParams: Promise<{ account?: string; property?: string }> }) {
  const { account, property } = await searchParams;
  const c = await ctx();
  const propertyId = property && UUID.test(property) ? property : null;
  // From a property: pre-fill it, and its account (linked account, else current manager, else current owner).
  const prop = propertyId
    ? (
        await c.sb
          .from("property_current")
          .select("id,name,address1,account_id,current_manager_id,current_owner_id")
          .eq("tenant_id", c.tenantId)
          .eq("id", propertyId)
          .maybeSingle()
      ).data
    : null;
  const accountId =
    account && UUID.test(account) ? account : (prop?.account_id ?? prop?.current_manager_id ?? prop?.current_owner_id ?? null);
  const [opts, members] = await Promise.all([loadOppOptions(c, accountId), getMembers(c)]);
  // The property may not belong to the chosen account (or there's no account): keep it selectable.
  if (prop?.id && !opts.properties.some((o) => o.id === prop.id)) {
    opts.properties.unshift({ id: prop.id, label: prop.name || prop.address1 || "Unnamed property" });
  }
  const back = prop?.id ? `/app/properties/${prop.id}` : accountId ? `/app/accounts/${accountId}` : "/app/pipeline";
  return (
    <div>
      <PageHeader back={back} title="New opportunity" />
      <OpportunityForm
        o={{ account_id: accountId, property_id: prop?.id ?? null, next_step_due: addDays(c.today, 2) }}
        {...opts}
        members={members}
        today={c.today}
      />
    </div>
  );
}
