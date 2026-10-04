import Link from "next/link";
import { PERSONA_ROLES, type PersonaRole } from "@/lib/domain/vocab";
import type { PickOption } from "@/lib/actions/book";
import { quietLabel } from "@/lib/format";
import { Chip, Empty, PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { TouchTimeline, type TimelineTouch } from "@/components/accounts/touch-timeline";
import { ContactEditForm } from "@/components/accounts/forms";
import { LinkedList, OpenTasks, Opportunities, type LinkLite, type OppLite, type TaskLite } from "@/components/accounts/related";
import { IconMail, IconPhone } from "@/components/icons";
import { MoveContact, type MoveContactPreview } from "@/components/accounts/move-contact";
import { tenureLabel } from "@/lib/domain/ownership";
import type { EmploymentRow } from "@/lib/server/ownership";

export type ContactDetailData = {
  today: string;
  c: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    title: string | null;
    persona_role: string;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    linkedin_url: string | null;
    account_id: string | null;
    notes: string | null;
    do_not_contact: boolean;
    email_status: string;
    last_touch_at: string | null;
    source: string;
  };
  account: PickOption | null;
  properties: LinkLite[];
  tasks: TaskLite[];
  opps: OppLite[];
  timeline: TimelineTouch[];
  daysSinceTouch: number | null;
  employment?: EmploymentRow[];
  touchCount?: number;
  oldCompanyBuildings?: number;
};

export function ContactDetailView({ d, movePreview }: { d: ContactDetailData; movePreview?: MoveContactPreview }) {
  const { c, account, today } = d;
  const phone = c.mobile ?? c.phone;
  return (
    <div>
      <LogContext contactId={c.id} accountId={c.account_id} />
      <PageHeader
        back="/app/contacts"
        title={c.full_name ?? "Unnamed contact"}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={c.persona_role === "economic_buyer" ? "accent" : "neutral"}>{PERSONA_ROLES[c.persona_role as PersonaRole] ?? c.persona_role}</Chip>
            {c.title && <span>{c.title}</span>}
            {c.do_not_contact && <Chip tone="bad">Do not contact</Chip>}
            {c.email_status === "bounced" && <Chip tone="bad">Email bounced</Chip>}
            {c.source === "field" && <Chip tone="good">Met in the field</Chip>}
          </span>
        }
      />
      <div className="px-4 text-sm">
        {account ? (
          <Link href={`/app/accounts/${account.id}`} className="inline-flex min-h-12 items-center font-semibold underline decoration-line underline-offset-2">
            {account.label}
          </Link>
        ) : (
          <span className="inline-flex min-h-12 items-center text-warning">No account linked — set one below so this person ranks and routes.</span>
        )}
        <span className="text-muted"> · {quietLabel(d.daysSinceTouch, c.last_touch_at)}</span>
      </div>
      <div className="flex gap-2 px-4 pt-1">
        <LogButton target={{ contactId: c.id, accountId: c.account_id }} variant="primary" className="flex-1" label={`Log with ${c.first_name ?? "them"}`} />
        {phone && !c.do_not_contact && (
          <a href={`tel:${phone}`} className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Call ${phone}`}>
            <IconPhone size={20} className="shrink-0" />
          </a>
        )}
        {c.email && !c.do_not_contact && (
          <a href={`mailto:${c.email}`} className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Email ${c.email}`}>
            <IconMail size={20} className="shrink-0" />
          </a>
        )}
      </div>
      {(phone || c.email) && (
        <div className="num px-4 pt-2 text-sm text-muted">{[phone, c.email].filter(Boolean).join(" · ")}</div>
      )}
      <div className="px-4 pt-3">
        <MoveContact
          contactId={c.id}
          name={c.full_name ?? "This contact"}
          firstName={c.first_name ?? c.full_name ?? "They"}
          title={c.title}
          oldCompany={account?.label ?? null}
          today={today}
          touches={d.touchCount ?? d.timeline.length}
          buildings={d.oldCompanyBuildings ?? 0}
          preview={movePreview}
        />
      </div>

      <OpenTasks tasks={d.tasks} today={today} />
      <Opportunities opps={d.opps} today={today} newHref={c.account_id ? `/app/pipeline/new?account=${c.account_id}` : undefined} />
      <LinkedList kind="properties" selfId={c.id} links={d.properties} />

      {d.employment && d.employment.length > 0 && (
        <>
          <SectionTitle>Work history</SectionTitle>
          <ol className="divide-y divide-line border-y border-line bg-surface">
            {d.employment.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/accounts/${e.account_id}`} className="flex min-h-11 items-center truncate font-semibold">
                    {e.account_name}
                  </Link>
                  <div className="truncate text-sm text-muted">{[e.title, tenureLabel(e.started_on, e.ended_on)].filter(Boolean).join(" · ")}</div>
                </div>
                {!e.ended_on && <Chip tone="good">Current</Chip>}
              </li>
            ))}
          </ol>
        </>
      )}

      <SectionTitle>Timeline</SectionTitle>
      {d.timeline.length === 0 ? <Empty title="No touches yet">Log the first one — it sets the follow-up.</Empty> : <TouchTimeline touches={d.timeline} />}

      <SectionTitle>Details</SectionTitle>
      <div id="edit">
        <ContactEditForm c={c} account={account} />
      </div>
    </div>
  );
}
