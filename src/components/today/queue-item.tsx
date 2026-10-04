import Link from "next/link";
import { TierPill } from "@/components/ui/bits";
import { LogButton } from "@/components/log/log-button";
import { TaskActions } from "@/components/today/task-actions";
import { IconChevronRight, IconMail, IconPhone } from "@/components/icons";
import { lateLabel } from "@/lib/format";
import { cn } from "@/components/ui/styles";
import type { PropertyBadge } from "@/lib/domain/badges-property";
import { PropertyBadges } from "@/components/accounts/property-badges";

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

export function QueueItem({ item, snoozeCount, badges, appointmentId }: { item: QueueRow; snoozeCount: number; badges?: PropertyBadge[]; /** A "Log outcome" task: logging completes this appointment. */ appointmentId?: string }) {
  const late = item.overdue_days ?? 0;
  const head = (
    <div className="flex items-start gap-3">
      <TierPill tier={item.icp_tier} />
      <div className="min-w-0 flex-1">
        <div className="font-display text-base font-bold leading-snug">{item.title}</div>
        <div className="mt-0.5 truncate text-sm text-muted">
          {item.account_name}
          {item.contact_name && <> · {item.contact_name}</>}
        </div>
        {(item.reason || late > 0) && (
          <div className="mt-0.5 text-sm">
            {late > 0 && <span className={cn("label mr-2 text-xs", late > 3 ? "text-danger" : "text-warning")}>{lateLabel(late)}</span>}
            <span className="text-muted">{item.reason}</span>
          </div>
        )}
        {badges && badges.length > 0 && <PropertyBadges badges={badges} max={3} className="mt-1.5" />}
      </div>
      {item.account_id && <IconChevronRight size={20} className="mt-0.5 shrink-0 text-muted" />}
    </div>
  );
  return (
    <li className="px-4 py-3">
      {item.account_id ? (
        <Link href={`/app/accounts/${item.account_id}`} className="-mx-2 -my-1 block rounded-lg px-2 py-1 hover:bg-surface-2" aria-label={`Open ${item.account_name ?? "account"}: ${item.title}`}>
          {head}
        </Link>
      ) : (
        head
      )}
      <div className="mt-3 flex items-center gap-2">
        <LogButton
          target={{ accountId: item.account_id, contactId: item.contact_id, propertyId: item.property_id, opportunityId: item.opportunity_id, appointmentId: appointmentId ?? null }}
          label={appointmentId ? "Log outcome" : undefined}
          size="md"
          variant="accent-outline"
          className="min-w-28"
        />
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
      </div>
      {item.item_type === "task" && item.task_id && <TaskActions taskId={item.task_id} snoozeCount={snoozeCount} hasAccount={!!item.account_id} />}
    </li>
  );
}
