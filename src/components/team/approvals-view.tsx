import { agoLabel } from "@/lib/format";
import { Chip, Empty, PageHeader } from "@/components/ui/bits";
import { ApprovalItem } from "@/components/team/approval-item";
import { IconChevronDown } from "@/components/icons";
import type { Json } from "@/lib/db/database.types";

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

export type ApprovalRow = { id: string; gate: string; action_type: string; summary: string; payload: Json; created_at: string };

export function ApprovalsView({ rows, ownerish, canDecideAny, back }: { rows: ApprovalRow[]; ownerish: boolean; canDecideAny: boolean; back: string }) {
  return (
    <div>
      <PageHeader back={back} title="Approvals" sub="Agents wait here before anything goes out." />
      {rows.length === 0 ? (
        <Empty title="Nothing waiting">When an agent drafts something that needs a person, it lands here.</Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {rows.map((a) => {
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
                  <summary className="label flex min-h-12 cursor-pointer list-none items-center gap-1 text-xs text-muted [&::-webkit-details-marker]:hidden">
                    <IconChevronDown size={16} /> Show details
                  </summary>
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
