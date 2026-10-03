import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadCold } from "@/lib/server/team";
import { ACCOUNT_TYPES, COLD_THRESHOLD_DAYS, type AccountType } from "@/lib/domain/vocab";
import { Empty, PageHeader, TierPill } from "@/components/ui/bits";
import { Table, Td } from "@/components/team/table";

export const metadata: Metadata = { title: "Cold P1/P2" };

export default async function ColdPage() {
  const c = await ctx();
  requireManager(c.s);
  const rows = await loadCold(c);
  return (
    <div>
      <PageHeader back="/app/team" title="Cold P1 / P2" sub={`P1 past ${COLD_THRESHOLD_DAYS[1]} days, P2 past ${COLD_THRESHOLD_DAYS[2]} days without a touch.`} />
      {rows.length === 0 ? (
        <Empty title="Nothing cold">Every priority account has been touched inside its window.</Empty>
      ) : (
        <Table head={["Account", "Tier", "Quiet", "Owner", "Open opps"]} numericFrom={2}>
          {rows.map((a) => (
            <tr key={a.id}>
              <Td className="font-semibold">
                <Link href={`/app/accounts/${a.id}`} className="underline decoration-line underline-offset-2">
                  {a.name}
                </Link>
                <div className="text-xs font-normal text-muted">
                  {ACCOUNT_TYPES[(a.account_type ?? "other") as AccountType]}
                  {a.city && ` · ${a.city}`}
                </div>
              </Td>
              <Td>
                <TierPill tier={a.icp_tier} />
              </Td>
              <Td num className="font-semibold text-warning">
                {a.days_since_touch}d
              </Td>
              <Td num>{a.owner}</Td>
              <Td num>{a.open_opps ?? 0}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
