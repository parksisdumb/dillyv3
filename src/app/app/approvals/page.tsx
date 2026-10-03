import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { ApprovalsView } from "@/components/team/approvals-view";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { sb, s, tenantId } = await ctx();
  const { data } = await sb
    .from("approval")
    .select("id,gate,action_type,summary,payload,created_at,expires_at")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("created_at")
    .limit(100);
  const ownerish = s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin;
  const canDecideAny = ownerish || ["manager", "rep", "reviewer"].includes(s.tenant.role);

  return <ApprovalsView rows={data ?? []} ownerish={ownerish} canDecideAny={canDecideAny} back={s.isManager ? "/app/team" : "/app/me"} />;
}
