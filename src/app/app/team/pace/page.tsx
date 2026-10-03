import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadPace } from "@/lib/server/team";
import { PageHeader } from "@/components/ui/bits";
import { Table, Td } from "@/components/team/table";
import { cn } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Pace" };

export default async function PacePage() {
  const c = await ctx();
  requireManager(c.s);
  const rows = await loadPace(c);
  return (
    <div>
      <PageHeader back="/app/team" title="Pace" sub="Week starts Monday. Follow-up % = tasks due this week that got done." />
      <Table head={["Rep", "Today", "Week", "In person", "Connects", "Follow-up", "Overdue", "Streak", "Points"]}>
        {rows.map((r) => (
          <tr key={r.user_id}>
            <Td className="font-semibold">
              {r.name}
              <span className="label ml-2 text-xs text-muted">{r.role}</span>
            </Td>
            <Td num>{r.touchesToday}</Td>
            <Td num>{r.touchesWeek}</Td>
            <Td num>{r.inPersonWeek}</Td>
            <Td num>{r.connectsWeek}</Td>
            <Td num className={cn(r.followUpPct != null && r.followUpPct < 80 && "font-semibold text-warning")}>
              {r.followUpPct == null ? "—" : `${r.followUpPct}% of ${r.followUpsDue}`}
            </Td>
            <Td num className={cn(r.overdue > 0 && "font-semibold text-danger")}>{r.overdue}</Td>
            <Td num>{r.streak}</Td>
            <Td num className="font-display font-bold">{r.pointsWeek}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
