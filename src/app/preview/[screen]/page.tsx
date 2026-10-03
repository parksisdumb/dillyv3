// Dev-only visual preview of the real screens with fixture data. Enabled only when DILLY_PREVIEW=1.
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { TodayView } from "@/components/today/today-view";
import { AccountsListView } from "@/components/accounts/accounts-list-view";
import { AccountDetailView } from "@/components/accounts/account-detail-view";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import { TeamHomeView } from "@/components/team/team-home-view";
import { ApprovalsView } from "@/components/team/approvals-view";
import { MeView } from "@/components/team/me-view";
import { CityChips, GoHeader } from "@/components/go/go-chrome";
import { FieldSession } from "@/components/go/field-session";
import { FocusSession } from "@/components/go/focus-session";
import { fixtures } from "@/app/preview/fixtures";
import { PreviewLogSheet, PreviewToast } from "@/app/preview/preview-client";

export const dynamic = "force-dynamic";

// Screens: today, go, go-focus, accounts, account, log-1, log-2, log-3, log-toast, pipeline, team, approvals, me

export default async function PreviewPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.DILLY_PREVIEW !== "1") notFound();
  const { screen } = await params;
  const f = fixtures();
  const manager = screen === "team" || screen === "approvals";
  const session = manager ? { ...f.session, fullName: "Tyler Fox", email: "tyler@foxroofing.co", tenant: { ...f.session.tenant, role: "manager" } } : f.session;

  let body: React.ReactNode;
  let active = "/app/today";
  switch (screen) {
    case "today":
      body = <TodayView d={f.todayData} />;
      break;
    case "go":
      active = "/app/go";
      body = (
        <>
          <GoHeader mode="field" />
          <CityChips cities={f.cities} city="Austin" />
          <FieldSession stops={f.austinStops} points={f.points} />
        </>
      );
      break;
    case "go-focus":
      active = "/app/go";
      body = (
        <>
          <GoHeader mode="focus" />
          <FocusSession items={f.focus} points={f.points} />
        </>
      );
      break;
    case "accounts":
      active = "/app/accounts";
      body = <AccountsListView sp={{}} scope="mine" q="" data={f.accounts} />;
      break;
    case "account":
      active = "/app/accounts";
      body = <AccountDetailView d={f.account} />;
      break;
    case "log-1":
    case "log-2":
    case "log-3":
      body = (
        <>
          <TodayView d={f.todayData} />
          <PreviewLogSheet
            data={f.logData}
            contact={screen === "log-1" ? null : f.logContacts[0]}
            picking={screen === "log-1"}
            channel={screen === "log-3" ? "site_visit" : null}
          />
        </>
      );
      break;
    case "log-toast":
      body = (
        <>
          <TodayView d={f.todayData} />
          <PreviewToast text="+10 · follow-up closed · next: Follow up with Dave Morales after visit Thu" />
        </>
      );
      break;
    case "pipeline":
      active = "/app/pipeline";
      body = <PipelineView scope="mine" columns={f.pipeline} today={f.today} />;
      break;
    case "team":
      active = "/app/team";
      body = <TeamHomeView d={f.team} />;
      break;
    case "approvals":
      active = "/app/team";
      body = <ApprovalsView rows={f.approvals} ownerish={false} canDecideAny back="/app/team" />;
      break;
    case "me":
      active = "/app/me";
      body = <MeView d={f.me} />;
      break;
    default:
      notFound();
  }

  return (
    <AppShell tenant={session.tenant} tenants={session.tenants} fullName={session.fullName} email={session.email} isManager={manager} activeHref={active}>
      {body}
    </AppShell>
  );
}
