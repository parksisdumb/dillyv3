import Link from "next/link";
import { TierPill } from "@/components/ui/bits";
import { LogButton } from "@/components/log/log-button";
import { TaskActions } from "@/components/today/task-actions";
import { IconMail, IconPhone } from "@/components/icons";
import { lateLabel } from "@/lib/format";
import { cn } from "@/components/ui/styles";

export type QueueRow = {
  item_type: string | null;
  task_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  property_id: string | null;
  title: string | null;
  reason: string | null;
  due_on: string | null;
  overdue_days: number | null;
  account_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  icp_tier: number | null;
};

const iconBtn = "inline-flex size-12 shrink-0 items-center justify-center rounded-lg border-2 border-line bg-surface hover:border-ink";

export function QueueItem({ item, snoozeCount }: { item: QueueRow; snoozeCount: number }) {
  const late = item.overdue_days ?? 0;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <TierPill tier={item.icp_tier} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-bold leading-snug">{item.title}</div>
          <div className="mt-0.5 text-sm text-muted">
            {item.account_id ? (
              <Link href={`/app/accounts/${item.account_id}`} className="underline decoration-line underline-offset-2 hover:text-ink">
                {item.account_name}
              </Link>
            ) : (
              item.account_name
            )}
            {item.contact_name && <> · {item.contact_name}</>}
          </div>
          {(item.reason || late > 0) && (
            <div className="mt-0.5 text-sm">
              {late > 0 && <span className={cn("label mr-2 text-xs", late > 3 ? "text-danger" : "text-warning")}>{lateLabel(late)}</span>}
              <span className="text-muted">{item.reason}</span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {item.phone ? (
          <a href={`tel:${item.phone}`} className={iconBtn} aria-label={`Call ${item.contact_name ?? item.account_name ?? ""}`}>
            <IconPhone size={20} />
          </a>
        ) : null}
        {item.email ? (
          <a href={`mailto:${item.email}`} className={iconBtn} aria-label={`Email ${item.contact_name ?? ""}`}>
            <IconMail size={20} />
          </a>
        ) : null}
        <div className="flex-1" />
        <LogButton
          target={{ accountId: item.account_id, contactId: item.contact_id, propertyId: item.property_id, opportunityId: item.opportunity_id }}
          size="md"
          variant="primary"
        />
      </div>
      {item.item_type === "task" && item.task_id && <TaskActions taskId={item.task_id} snoozeCount={snoozeCount} hasAccount={!!item.account_id} />}
    </li>
  );
}
