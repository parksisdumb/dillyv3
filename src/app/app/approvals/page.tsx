import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { agoLabel } from "@/lib/format";
import { Chip, Empty, PageHeader } from "@/components/ui/bits";
import { ApprovalItem } from "@/components/team/approval-item";

export const metadata: Metadata = { title: "Approvals" };

const GATES: Record<string, string> = {
  G1: "Outbound message",
  G2: "Estimate",
  G3: "Proposal",
  G4: "Legal",
  G5: "Recruiting",
  G6: "Spend",
  G7: "Publish",
  G8: "Bulk CRM change",
  G9: "Customer financial doc",
};
const OWNER_ONLY = ["G4", "G6", "G9"];

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

  return (
    <div>
      <PageHeader back={s.isManager ? "/app/team" : "/app/me"} title="Approvals" sub="Agents wait here before anything goes out." />
      {(data ?? []).length === 0 ? (
        <Empty title="Nothing waiting">When an agent drafts something that needs a person, it lands here.</Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {(data ?? []).map((a) => {
            const payload = JSON.stringify(a.payload, null, 2);
            return (
              <li key={a.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={OWNER_ONLY.includes(a.gate) ? "bad" : "accent"}>
                    {a.gate} · {GATES[a.gate] ?? a.gate}
                  </Chip>
                  <span className="label text-xs text-muted">{a.action_type.replace(/_/g, " ")}</span>
                  <span className="flex-1" />
                  <span className="num text-xs text-muted">{agoLabel(a.created_at)}</span>
                </div>
                <p className="mt-2 font-display text-base font-bold">{a.summary}</p>
                <details className="mt-2">
                  <summary className="label min-h-10 cursor-pointer py-2 text-xs text-muted">Show details</summary>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{payload}</pre>
                </details>
                <ApprovalItem id={a.id} payload={payload} canDecide={OWNER_ONLY.includes(a.gate) ? ownerish : canDecideAny} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
