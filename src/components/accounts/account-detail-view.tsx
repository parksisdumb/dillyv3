import Link from "next/link";
import { ACCOUNT_TYPES, PERSONA_ROLES, STAGES, STALL_DAYS, type AccountType, type PersonaRole, type Stage } from "@/lib/domain/vocab";
import { dueLabel, lateLabel, money, quietLabel, mapsUrl, daysBetween } from "@/lib/format";
import { Chip, Empty, PageHeader, SectionTitle, StateChip, TierPill } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { OnboardingStepper } from "@/components/accounts/onboarding-stepper";
import { PreferenceControl } from "@/components/accounts/preference-control";
import { TouchTimeline, type TimelineTouch } from "@/components/accounts/touch-timeline";
import { IconDirections, IconEdit, IconMail, IconPhone, IconPlus } from "@/components/icons";
import type { PropertyBadge } from "@/lib/domain/badges-property";
import { PARTY_ROLES, tenureLabel, type PartyRole } from "@/lib/domain/ownership";
import type { PastProperty } from "@/lib/server/ownership";
import { PropertyBadges } from "@/components/accounts/property-badges";
import { MoveProperties, type MovePerson, type MovePreview } from "@/components/accounts/move-properties";

const PERSONA_ORDER = Object.keys(PERSONA_ROLES) as PersonaRole[];

export type AccountDetailData = {
  id: string;
  today: string;
  a: {
    name: string | null;
    icp_tier: number | null;
    relationship_state: string | null;
    account_type: string | null;
    days_since_touch: number | null;
    last_touch_at: string | null;
    excluded_reason: string | null;
    phone: string | null;
    address1: string | null;
    city: string | null;
    state: string | null;
    onboarding_status: string | null;
    preference: string | null;
    preference_reason: string | null;
    open_value: number | null;
  };
  task: { id: string; title: string; due_on: string; reason: string | null } | null;
  opps: { id: string; name: string; stage: string; value_estimate: number | null; next_step: string | null; next_step_due: string | null; stage_changed_at: string }[];
  props: { id: string; name: string | null; address1: string | null; city: string | null; roof_system: string | null; roof_install_year: number | null; roof_area_sf: number | null }[];
  contacts: { id: string; full_name: string | null; title: string | null; persona_role: string; phone: string | null; mobile: string | null; email: string | null; do_not_contact: boolean }[];
  timeline: TimelineTouch[];
  ownerName: string | null;
  propBadges?: Record<string, PropertyBadge[]>;
  past?: PastProperty[];
  movePeople?: MovePerson[];
};

export function AccountDetailView({ d, movePreview }: { d: AccountDetailData; movePreview?: MovePreview }) {
  const { id, today, a, task, opps, props, contacts, timeline, ownerName } = d;
  const grouped = PERSONA_ORDER.map((role) => ({ role, people: contacts.filter((p) => p.persona_role === role) })).filter((g) => g.people.length);
  const sunk = a.relationship_state === "excluded" || a.relationship_state === "do_not_pursue";
  const directions = mapsUrl([a.address1, a.city, a.state]);

  return (
    <div>
      <LogContext accountId={id} />
      <PageHeader
        back="/app/accounts"
        title={a.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <TierPill tier={a.icp_tier} />
            <StateChip state={a.relationship_state} />
            <span>{ACCOUNT_TYPES[(a.account_type ?? "other") as AccountType]}</span>
            <span>{quietLabel(a.days_since_touch, a.last_touch_at)}</span>
          </span>
        }
        action={
          <Link href={`/app/accounts/${id}/edit`} className="inline-flex size-12 items-center justify-center rounded-lg border-2 border-line" aria-label="Edit account">
            <IconEdit size={20} />
          </Link>
        }
      />
      {a.excluded_reason && (
        <p className={cn("mx-4 rounded-lg border-2 px-3 py-2 text-sm font-semibold", sunk ? "border-danger text-danger" : "border-line")}>
          Off the list — {a.excluded_reason}
        </p>
      )}

      <div className="flex flex-wrap gap-2 px-4 pt-2">
        <LogButton target={{ accountId: id }} variant="primary" label="Log on this account" className="flex-1" />
        {a.phone && (
          <a href={`tel:${a.phone}`} className={btn("secondary", "md")} aria-label="Call main line">
            <IconPhone size={20} />
          </a>
        )}
        {directions && (
          <a href={directions} target="_blank" rel="noreferrer" className={btn("secondary", "md")} aria-label="Directions">
            <IconDirections size={20} />
          </a>
        )}
      </div>

      <div className="mt-2 px-4 text-sm text-muted">
        Owner: {ownerName ?? "Unassigned"}
        {a.city && <> · {[a.address1, a.city, a.state].filter(Boolean).join(", ")}</>}
      </div>

      {/* Next task */}
      <SectionTitle>Next up</SectionTitle>
      <div className="border-y border-line bg-surface px-4 py-3">
        {task ? (
          <div>
            <div className="font-display text-base font-bold">{task.title}</div>
            <div className="text-sm text-muted">
              {task.due_on < today ? (
                <span className="label text-xs text-danger">{lateLabel(daysBetween(task.due_on, today))}</span>
              ) : (
                dueLabel(task.due_on, today)
              )}
              {task.reason && <> · {task.reason}</>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Nothing scheduled. Log a touch and the next step sets itself.</p>
        )}
      </div>

      {/* Onboarding + preference */}
      <section className="mt-4 border-y border-line bg-surface px-4 py-4">
        <OnboardingStepper accountId={id} status={a.onboarding_status ?? "none"} />
      </section>
      <section className="mt-4 border-y border-line bg-surface px-4 py-4">
        <PreferenceControl accountId={id} preference={a.preference} reason={a.preference_reason} />
      </section>

      {/* Opportunities */}
      <SectionTitle
        action={
          <Link href={`/app/pipeline/new?account=${id}`} className={btn("ghost", "sm")}>
            <IconPlus size={16} /> Opportunity
          </Link>
        }
      >
        Open opportunities · {money(a.open_value)}
      </SectionTitle>
      {opps.length === 0 ? (
        <p className="px-4 text-sm text-muted">No open jobs.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {opps.map((o) => {
            const days = daysBetween(o.stage_changed_at.slice(0, 10), today);
            const stalled = days > (STALL_DAYS[o.stage as Stage] ?? 999);
            return (
              <li key={o.id}>
                <Link href={`/app/pipeline/${o.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
                    <span className="num font-display font-bold">{money(o.value_estimate)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Chip>{STAGES[o.stage as Stage]}</Chip>
                    <span className="num">{days}d in stage</span>
                    {stalled && <Chip tone="warn">Stalled</Chip>}
                  </div>
                  {o.next_step && (
                    <div className="mt-1 text-sm">
                      Next: {o.next_step}
                      {o.next_step_due &&
                        (o.next_step_due < today ? (
                          <span className="font-semibold text-danger"> · {lateLabel(daysBetween(o.next_step_due, today))}</span>
                        ) : (
                          <span className="text-muted"> · {dueLabel(o.next_step_due, today)}</span>
                        ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Properties */}
      <SectionTitle
        action={
          <span className="flex items-center">
            {props.length > 0 && (
              <MoveProperties
                accountId={id}
                accountName={a.name ?? "this account"}
                today={today}
                properties={props.map((p) => ({ id: p.id, name: p.name || p.address1 || "Unnamed property", sub: [p.address1, p.city].filter(Boolean).join(", ") || null }))}
                people={d.movePeople ?? []}
                preview={movePreview}
              />
            )}
            <Link href={`/app/accounts/${id}/property/new`} className={btn("ghost", "sm")}>
              <IconPlus size={16} /> Property
            </Link>
          </span>
        }
      >
        Properties · {props.length}
      </SectionTitle>
      {props.length === 0 ? (
        <p className="px-4 text-sm text-muted">No buildings yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {props.map((p) => {
            const roofAge = p.roof_install_year ? new Date().getFullYear() - p.roof_install_year : null;
            return (
              <li key={p.id}>
                <Link href={`/app/properties/${p.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="font-semibold">{p.name || p.address1 || "Unnamed property"}</div>
                  <div className="text-sm text-muted">{[p.address1, p.city].filter(Boolean).join(", ")}</div>
                  {d.propBadges?.[p.id] ? (
                    <PropertyBadges badges={d.propBadges[p.id]} max={3} className="mt-1.5" />
                  ) : (
                    <div className="num mt-0.5 text-sm">
                      {p.roof_system ? <span className="label text-xs">{p.roof_system}</span> : <span className="text-muted">Roof unknown</span>}
                      {roofAge != null && <span className={cn("ml-2", roofAge >= 15 && "font-semibold text-warning")}>{roofAge} yrs</span>}
                      {p.roof_area_sf && <span className="ml-2 text-muted">{Math.round(Number(p.roof_area_sf)).toLocaleString()} sf</span>}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Past properties: buildings this company used to manage/own */}
      {d.past && d.past.length > 0 && (
        <>
          <SectionTitle>Past properties · {d.past.length}</SectionTitle>
          <ul className="divide-y divide-line border-y border-line bg-surface">
            {d.past.map((p) => (
              <li key={`${p.id}-${p.role}`}>
                <Link href={`/app/properties/${p.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                    <span className="label shrink-0 text-xs text-muted">{PARTY_ROLES[p.role as PartyRole]?.label ?? p.role}</span>
                  </div>
                  <div className="truncate text-sm text-muted">
                    {tenureLabel(p.started_on, p.ended_on)}
                    {p.now && <> · now {p.now}</>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Contacts */}
      <SectionTitle
        action={
          <Link href={`/app/accounts/${id}/contact/new`} className={btn("ghost", "sm")}>
            <IconPlus size={16} /> Contact
          </Link>
        }
      >
        People · {contacts.length}
      </SectionTitle>
      {grouped.length === 0 ? (
        <p className="px-4 text-sm text-muted">Nobody yet. Add the person you met.</p>
      ) : (
        grouped.map((g) => (
          <div key={g.role}>
            <div className="label bg-ground px-4 pb-1 pt-3 text-xs text-muted">{PERSONA_ROLES[g.role]}</div>
            <ul className="divide-y divide-line border-y border-line bg-surface">
              {g.people.map((p) => {
                const phone = p.mobile ?? p.phone;
                return (
                  <li key={p.id} className="flex items-center gap-2 px-4 py-2">
                    <Link href={`/app/contacts/${p.id}`} className="min-w-0 flex-1 py-1">
                      <div className="truncate font-semibold">
                        {p.full_name ?? "Unnamed"}
                        {p.do_not_contact && <Chip tone="bad" className="ml-2">Do not contact</Chip>}
                      </div>
                      <div className="truncate text-sm text-muted">{p.title ?? " "}</div>
                    </Link>
                    {phone && !p.do_not_contact && (
                      <a href={`tel:${phone}`} className="inline-flex size-12 items-center justify-center rounded-lg border-2 border-line" aria-label={`Call ${p.full_name ?? ""}`}>
                        <IconPhone size={20} />
                      </a>
                    )}
                    {p.email && !p.do_not_contact && (
                      <a href={`mailto:${p.email}`} className="inline-flex size-12 items-center justify-center rounded-lg border-2 border-line" aria-label={`Email ${p.full_name ?? ""}`}>
                        <IconMail size={20} />
                      </a>
                    )}
                    <LogButton target={{ accountId: id, contactId: p.id }} label="Log" ariaLabel={`Log touch with ${p.full_name ?? "contact"}`} size="md" className="px-3" />
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {/* Timeline */}
      <SectionTitle>Timeline</SectionTitle>
      {timeline.length === 0 ? <Empty title="No touches yet">First touch earns the account a place in your rhythm.</Empty> : <TouchTimeline touches={timeline} />}
    </div>
  );
}
