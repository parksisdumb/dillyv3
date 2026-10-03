import Link from "next/link";
import { Chip, StateChip, TierPill } from "@/components/ui/bits";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/vocab";
import { quietLabel } from "@/lib/format";
import { cn } from "@/components/ui/styles";
import { IconChevronRight } from "@/components/icons";

export type AccountRowData = {
  id: string | null;
  name: string | null;
  account_type: string | null;
  icp_tier: number | null;
  relationship_state: string | null;
  last_touch_at: string | null;
  days_since_touch: number | null;
  property_count: number | null;
  contact_count: number | null;
  open_opps: number | null;
  excluded_reason: string | null;
  preference: string | null;
  city: string | null;
};

export function AccountRow({ a }: { a: AccountRowData }) {
  const sunk = a.relationship_state === "excluded" || a.relationship_state === "do_not_pursue" || a.preference === "deprioritize";
  return (
    <li className={cn(sunk && "bg-surface-2/60")}>
      <Link href={`/app/accounts/${a.id}`} className="flex min-h-16 items-start gap-3 px-4 py-3 hover:bg-surface-2">
        <TierPill tier={a.icp_tier} />
        <div className={cn("min-w-0 flex-1", sunk && "opacity-60")}>
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-base font-bold">{a.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <StateChip state={a.relationship_state} />
            {a.preference === "deprioritize" && <Chip>Deprioritized</Chip>}
            <span>{ACCOUNT_TYPES[(a.account_type ?? "other") as AccountType] ?? a.account_type}</span>
            {a.city && <span>· {a.city}</span>}
          </div>
          <div className="num mt-1 text-sm text-muted">
            {quietLabel(a.days_since_touch, a.last_touch_at)} · {a.property_count ?? 0} bldg · {a.contact_count ?? 0} people
            {(a.open_opps ?? 0) > 0 && <> · {a.open_opps} open</>}
          </div>
          {a.excluded_reason && <div className="mt-1 text-sm font-semibold text-danger">Off the list — {a.excluded_reason}</div>}
        </div>
        <IconChevronRight size={20} className="mt-1 shrink-0 text-muted" />
      </Link>
    </li>
  );
}
