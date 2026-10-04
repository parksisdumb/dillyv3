import { Suspense } from "react";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadScorecard } from "@/lib/server/scorecard";
import { saveScorecardTargets } from "@/lib/actions/settings";
import { ScorecardView } from "@/components/team/scorecard-view";
import { TeamSkeleton } from "@/components/status/skeletons";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/fields";
import { SectionTitle } from "@/components/ui/bits";
import type { Targets } from "@/lib/domain/scorecard";

export const metadata: Metadata = { title: "Scorecard" };

function TargetsForm({ t }: { t: Targets }) {
  return (
    <>
      <SectionTitle>Targets (owners &amp; admins)</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveScorecardTargets} submitLabel="Save targets" submitVariant="secondary" submitSize="md" className="px-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <TextField label="Meetings / month" name="meetings_month" type="number" min={0} inputMode="numeric" defaultValue={t.meetings_month} />
            <TextField label="Paperwork / month" name="paperwork_month" type="number" min={0} inputMode="numeric" defaultValue={t.paperwork_month} />
            <TextField label="In person / rep / week" name="in_person_rep_week" type="number" min={0} inputMode="numeric" defaultValue={t.in_person_rep_week} />
            <TextField label="First touches / month" name="first_touches_month" type="number" min={0} inputMode="numeric" defaultValue={t.first_touches_month} />
            <TextField label="Follow-up %" name="follow_up_pct" type="number" min={0} inputMode="numeric" defaultValue={t.follow_up_pct} />
          </div>
          <p className="text-sm text-muted">Blank = no goal line. Monthly team targets show on the sparklines as a weekly equivalent (× 12 ÷ 52).</p>
        </ActionForm>
      </div>
    </>
  );
}

async function Body() {
  const c = await ctx();
  requireManager(c.s);
  const sc = await loadScorecard(c);
  const ownerish = c.s.tenant.role === "owner" || c.s.tenant.role === "admin" || c.s.isPlatformAdmin;
  return <ScorecardView sc={sc} tenantName={c.s.tenant.name} targetsForm={ownerish ? <TargetsForm t={sc.targets} /> : null} />;
}

export default function ScorecardPage() {
  return (
    <Suspense fallback={<TeamSkeleton />}>
      <Body />
    </Suspense>
  );
}
