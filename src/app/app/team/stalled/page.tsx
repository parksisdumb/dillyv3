import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadStalled } from "@/lib/server/team";
import { STAGES, STALL_DAYS, type Stage } from "@/lib/domain/vocab";
import { money, shortDate } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui/bits";
import { Table, Td } from "@/components/team/table";

export const metadata: Metadata = { title: "Stalled" };

export default async function StalledPage() {
  const c = await ctx();
  requireManager(c.s);
  const rows = await loadStalled(c);
  return (
    <div>
      <PageHeader
        back="/app/team"
        title="Stalled opportunities"
        sub={`Past the stage limit (${Object.entries(STALL_DAYS)
          .map(([k, v]) => `${STAGES[k as Stage]} ${v}d`)
          .join(", ")}), or the next step is missing or late.`}
      />
      {rows.length === 0 ? (
        <Empty title="Nothing stalled">Every open job is moving and has a next step.</Empty>
      ) : (
        <Table head={["Opportunity", "Stage", "Why", "Next step", "Owner", "Value"]} numericFrom={5}>
          {rows.map((o) => (
            <tr key={o.id}>
              <Td className="font-semibold">
                <Link href={`/app/pipeline/${o.id}`} className="underline decoration-line underline-offset-2">
                  {o.name}
                </Link>
                {o.account && <div className="text-xs font-normal text-muted">{o.account}</div>}
              </Td>
              <Td>{STAGES[o.stage as Stage]}</Td>
              <Td className="font-semibold text-warning">{o.why}</Td>
              <Td>{o.next_step ? `${o.next_step}${o.next_step_due ? ` · ${shortDate(o.next_step_due)}` : ""}` : "—"}</Td>
              <Td>{o.owner}</Td>
              <Td num className="font-display font-bold">
                {money(o.value_estimate)}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
