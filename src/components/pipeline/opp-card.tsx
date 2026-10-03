import Link from "next/link";
import { Chip } from "@/components/ui/bits";
import { dueLabel, lateLabel, money, daysBetween } from "@/lib/format";
import { cn } from "@/components/ui/styles";

export type OppCardData = {
  id: string;
  name: string;
  account: string | null;
  value: number | null;
  daysInStage: number;
  stalled: boolean;
  next_step: string | null;
  next_step_due: string | null;
};

export function OppCard({ o, today, compact = false }: { o: OppCardData; today: string; compact?: boolean }) {
  const late = o.next_step_due && o.next_step_due < today ? daysBetween(o.next_step_due, today) : 0;
  return (
    <Link
      href={`/app/pipeline/${o.id}`}
      className={cn("block hover:bg-surface-2", compact ? "rounded-lg border-2 border-line bg-surface p-3" : "px-4 py-3", o.stalled && compact && "border-warning")}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
        <span className="num font-display font-bold">{money(o.value)}</span>
      </div>
      {o.account && <div className="truncate text-sm text-muted">{o.account}</div>}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="num text-muted">{o.daysInStage}d in stage</span>
        {o.stalled && <Chip tone="warn">Stalled</Chip>}
      </div>
      <div className="mt-1 text-sm">
        {o.next_step ? (
          <>
            <span>{o.next_step}</span>
            {o.next_step_due && (
              <span className={cn("ml-1", late ? "font-semibold text-danger" : "text-muted")}>· {late ? lateLabel(late) : dueLabel(o.next_step_due, today)}</span>
            )}
          </>
        ) : (
          <span className="font-semibold text-danger">No next step</span>
        )}
      </div>
    </Link>
  );
}
