import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { ACCOUNT_TYPES } from "@/lib/domain/vocab";
import { AccountsListView, type SP } from "@/components/accounts/accounts-list-view";
import { getMembers } from "@/lib/server/members";

export const metadata: Metadata = { title: "Accounts" };

async function AccountsPageBody({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, s, tenantId } = await ctx();
  const scope = sp.scope === "all" ? "all" : "mine";
  const q = cleanQuery(sp.q);

  let query = sb
    .from("account_ranked")
    .select(
      "id,name,account_type,icp_tier,relationship_state,last_touch_at,days_since_touch,property_count,contact_count,open_opps,excluded_reason,preference,city,rank_score,owner_user_id",
    )
    .eq("tenant_id", tenantId)
    .eq("is_test", false);
  if (scope === "mine") query = query.eq("owner_user_id", s.userId);
  if (q) query = query.ilike("normalized_name", `%${q.toLowerCase()}%`);
  if (sp.state === "excluded") query = query.in("relationship_state", ["excluded", "do_not_pursue"]);
  else if (sp.state) query = query.eq("relationship_state", sp.state);
  if (sp.type && sp.type in ACCOUNT_TYPES) query = query.eq("account_type", sp.type);
  if (sp.tier && /^[1-4]$/.test(sp.tier)) query = query.eq("icp_tier", Number(sp.tier));
  const [{ data, error }, members] = await Promise.all([
    query.order("rank_score", { ascending: false, nullsFirst: false }).order("name").limit(150),
    s.isManager ? getMembers({ sb, tenantId }) : Promise.resolve(null),
  ]);
  if (!members) return <AccountsListView sp={sp} scope={scope} q={q} data={data} error={error?.message} />;

  // Managers: owner names for Select mode, and the team for Assign.
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const rows = (data ?? []).map((r) => ({ ...r, owner_name: r.owner_user_id ? names.get(r.owner_user_id) ?? "—" : null }));
  return (
    <AccountsListView
      sp={sp}
      scope={scope}
      q={q}
      data={data ? rows : null}
      error={error?.message}
      manager={{ members: members.filter((m) => ["rep", "manager", "owner", "admin"].includes(m.role)).map((m) => ({ user_id: m.user_id, name: m.name, role: m.role })) }}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function AccountsPage(props: Parameters<typeof AccountsPageBody>[0]) {
  const key = JSON.stringify(await props.searchParams);
  return pageBody(() => AccountsPageBody(props), key);
}
