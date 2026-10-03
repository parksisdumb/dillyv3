import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { PageHeader } from "@/components/ui/bits";
import { OpportunityForm } from "@/components/pipeline/opp-forms";
import { loadOppOptions } from "@/components/pipeline/load-options";
import { addDays } from "@/lib/format";

export const metadata: Metadata = { title: "New opportunity" };

export default async function NewOpportunity({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const c = await ctx();
  const accountId = account && /^[0-9a-f-]{36}$/i.test(account) ? account : null;
  const [opts, members] = await Promise.all([loadOppOptions(c, accountId), getMembers(c)]);
  return (
    <div>
      <PageHeader back={accountId ? `/app/accounts/${accountId}` : "/app/pipeline"} title="New opportunity" />
      <OpportunityForm o={{ account_id: accountId, next_step_due: addDays(c.today, 2) }} {...opts} members={members} today={c.today} />
    </div>
  );
}
