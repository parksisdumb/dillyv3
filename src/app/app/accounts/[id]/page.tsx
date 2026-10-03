import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { ACCOUNT_TYPES, PERSONA_ROLES, STAGES, STALL_DAYS, type AccountType, type PersonaRole, type Stage } from "@/lib/domain/vocab";
import { dueLabel, lateLabel, money, quietLabel, mapsUrl, daysBetween } from "@/lib/format";
import { Chip, Empty, PageHeader, SectionTitle, StateChip, TierPill } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { OnboardingStepper } from "@/components/accounts/onboarding-stepper";
import { PreferenceControl } from "@/components/accounts/preference-control";
import { TouchTimeline } from "@/components/accounts/touch-timeline";
import { IconDirections, IconEdit, IconMail, IconPhone, IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "Account" };

const PERSONA_ORDER = Object.keys(PERSONA_ROLES) as PersonaRole[];

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;

  const { data: a } = await sb.from("account_ranked").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!a) notFound();

  const [task, opps, props, contacts, touches, owner] = await Promise.all([
    sb.from("task").select("id,title,due_on,reason").eq("tenant_id", tenantId).eq("account_id", id).eq("status", "open").order("due_on").limit(1).maybeSingle(),
    sb
      .from("opportunity")
      .select("id,name,stage,value_estimate,next_step,next_step_due,stage_changed_at")
      .eq("tenant_id", tenantId)
      .eq("account_id", id)
      .not("stage", "in", "(won,lost)")
      .order("value_estimate", { ascending: false, nullsFirst: false }),
    sb
      .from("property")
      .select("id,name,address1,city,state,roof_system,roof_install_year,roof_area_sf,asset_class")
      .eq("tenant_id", tenantId)
      .eq("account_id", id)
      .is("duplicate_of", null)
      .order("name"),
    sb
      .from("contact")
      .select("id,full_name,title,persona_role,phone,mobile,email,do_not_contact,last_touch_at")
      .eq("tenant_id", tenantId)
      .eq("account_id", id)
      .is("duplicate_of", null)
      .order("last_touch_at", { ascending: false, nullsFirst: false }),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("account_id", id).order("occurred_at", { ascending: false }).limit(40),
    a.owner_user_id ? sb.from("profile").select("full_name,email").eq("id", a.owner_user_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const timeline = await withNames(c, touches.data ?? []);
  const grouped = PERSONA_ORDER.map((role) => ({ role, people: (contacts.data ?? []).filter((p) => p.persona_role === role) })).filter((g) => g.people.length);
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
            <span>· {quietLabel(a.days_since_touch, a.last_touch_at)}</span>
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
        Owner: {owner.data?.full_name ?? owner.data?.email ?? "Unassigned"}
        {a.city && <> · {[a.address1, a.city, a.state].filter(Boolean).join(", ")}</>}
      </div>

      {/* Next task */}
      <SectionTitle>Next up</SectionTitle>
      <div className="border-y border-line bg-surface px-4 py-3">
        {task.data ? (
          <div>
            <div className="font-display text-base font-bold">{task.data.title}</div>
            <div className="text-sm text-muted">
              {task.data.due_on < today ? (
                <span className="label text-xs text-danger">{lateLabel(daysBetween(task.data.due_on, today))}</span>
              ) : (
                dueLabel(task.data.due_on, today)
              )}
              {task.data.reason && <> · {task.data.reason}</>}
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
      {(opps.data ?? []).length === 0 ? (
        <p className="px-4 text-sm text-muted">No open jobs.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {(opps.data ?? []).map((o) => {
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
                      {o.next_step_due && <span className="text-muted"> · {dueLabel(o.next_step_due, today)}</span>}
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
          <Link href={`/app/accounts/${id}/property/new`} className={btn("ghost", "sm")}>
            <IconPlus size={16} /> Property
          </Link>
        }
      >
        Properties · {(props.data ?? []).length}
      </SectionTitle>
      {(props.data ?? []).length === 0 ? (
        <p className="px-4 text-sm text-muted">No buildings yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {(props.data ?? []).map((p) => {
            const roofAge = p.roof_install_year ? new Date().getFullYear() - p.roof_install_year : null;
            return (
              <li key={p.id}>
                <Link href={`/app/properties/${p.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="font-semibold">{p.name || p.address1 || "Unnamed property"}</div>
                  <div className="text-sm text-muted">{[p.address1, p.city].filter(Boolean).join(", ")}</div>
                  <div className="num mt-0.5 text-sm">
                    {p.roof_system ? <span className="label text-xs">{p.roof_system}</span> : <span className="text-muted">Roof unknown</span>}
                    {roofAge != null && <span className={cn("ml-2", roofAge >= 15 && "font-semibold text-warning")}>{roofAge} yrs</span>}
                    {p.roof_area_sf && <span className="ml-2 text-muted">{Math.round(Number(p.roof_area_sf)).toLocaleString()} sf</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Contacts */}
      <SectionTitle
        action={
          <Link href={`/app/accounts/${id}/contact/new`} className={btn("ghost", "sm")}>
            <IconPlus size={16} /> Contact
          </Link>
        }
      >
        People · {(contacts.data ?? []).length}
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
                    <LogButton target={{ accountId: id, contactId: p.id }} label="" ariaLabel={`Log touch with ${p.full_name ?? "contact"}`} size="md" className="size-12 px-0" />
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
