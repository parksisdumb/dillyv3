import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { SERVICE_LINES, STAGES, type ServiceLine, type Stage } from "@/lib/domain/vocab";
import { daysInStage, isStalled } from "@/lib/domain/pipeline";
import { money, shortDate } from "@/lib/format";
import { Chip, PageHeader, SectionTitle, Stat } from "@/components/ui/bits";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { TouchTimeline } from "@/components/accounts/touch-timeline";
import { LostForm, OpportunityForm, WonForm } from "@/components/pipeline/opp-forms";
import { loadOppOptions } from "@/components/pipeline/load-options";

export const metadata: Metadata = { title: "Opportunity" };

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;
  const { data: o } = await sb.from("opportunity").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!o) notFound();
  const [opts, members, touches] = await Promise.all([
    loadOppOptions(c, o.account_id),
    getMembers(c),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("opportunity_id", id).order("occurred_at", { ascending: false }).limit(20),
  ]);
  const timeline = await withNames(c, touches.data ?? []);
  const days = daysInStage(o.stage_changed_at, today);
  const open = o.stage !== "won" && o.stage !== "lost";
  const accountName = opts.accounts.find((a) => a.id === o.account_id)?.label;

  return (
    <div>
      <LogContext opportunityId={id} accountId={o.account_id} propertyId={o.property_id} contactId={o.primary_contact_id} />
      <PageHeader
        back="/app/pipeline"
        title={o.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={o.stage === "won" ? "good" : o.stage === "lost" ? "bad" : "neutral"}>{STAGES[o.stage as Stage]}</Chip>
            <span>{SERVICE_LINES[o.service_line as ServiceLine]}</span>
            {accountName && (
              <Link className="underline decoration-line underline-offset-2" href={`/app/accounts/${o.account_id}`}>
                {accountName}
              </Link>
            )}
            {open && isStalled(o.stage, days) && <Chip tone="warn">Stalled</Chip>}
          </span>
        }
      />
      <div className="grid grid-cols-3 gap-3 px-4 py-2">
        <Stat label="Value" value={money(o.value_estimate)} />
        <Stat label="In stage" value={`${days}d`} />
        <Stat label="GP" value={money(o.gross_profit_estimate)} />
      </div>
      {o.stage === "lost" && o.lost_reason && <p className="mx-4 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">Lost {shortDate(o.lost_at)} — {o.lost_reason}</p>}
      {o.stage === "won" && <p className="mx-4 rounded-lg border-2 border-success px-3 py-2 text-sm text-success">Won {shortDate(o.won_at)}</p>}

      <div className="px-4 pt-2">
        <LogButton target={{ opportunityId: id, accountId: o.account_id, propertyId: o.property_id, contactId: o.primary_contact_id }} variant="primary" className="w-full" label="Log on this job" />
      </div>

      {open && (
        <>
          <SectionTitle>Edit</SectionTitle>
          <OpportunityForm o={{ ...o, value_estimate: o.value_estimate == null ? null : Number(o.value_estimate), gross_profit_estimate: o.gross_profit_estimate == null ? null : Number(o.gross_profit_estimate) }} {...opts} members={members} today={today} />
          <SectionTitle>Close it out</SectionTitle>
          <div className="grid gap-4 px-4 md:grid-cols-2">
            <WonForm id={id} />
            <LostForm id={id} />
          </div>
        </>
      )}

      {timeline.length > 0 && (
        <>
          <SectionTitle>Touches on this job</SectionTitle>
          <TouchTimeline touches={timeline} />
        </>
      )}
    </div>
  );
}
