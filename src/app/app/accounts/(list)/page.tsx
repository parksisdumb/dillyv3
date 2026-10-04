import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { ACCOUNT_TYPES } from "@/lib/domain/vocab";
import { AccountsListView, type SP } from "@/components/accounts/accounts-list-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, s, tenantId } = await ctx();
  const scope = sp.scope === "all" ? "all" : "mine";
  const q = cleanQuery(sp.q);

  let query = sb
    .from("account_ranked")
    .select(
      "id,name,account_type,icp_tier,relationship_state,last_touch_at,days_since_touch,property_count,contact_count,open_opps,excluded_reason,preference,city,rank_score",
    )
    .eq("tenant_id", tenantId)
    .eq("is_test", false);
  if (scope === "mine") query = query.eq("owner_user_id", s.userId);
  if (q) query = query.ilike("normalized_name", `%${q.toLowerCase()}%`);
  if (sp.state === "excluded") query = query.in("relationship_state", ["excluded", "do_not_pursue"]);
  else if (sp.state) query = query.eq("relationship_state", sp.state);
  if (sp.type && sp.type in ACCOUNT_TYPES) query = query.eq("account_type", sp.type);
  if (sp.tier && /^[1-4]$/.test(sp.tier)) query = query.eq("icp_tier", Number(sp.tier));
  const { data, error } = await query.order("rank_score", { ascending: false, nullsFirst: false }).order("name").limit(150);

  return <AccountsListView sp={sp} scope={scope} q={q} data={data} error={error?.message} />;
}
