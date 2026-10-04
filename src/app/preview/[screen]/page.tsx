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
import { ContactsListView } from "@/components/accounts/contacts-list-view";
import { PropertiesListView } from "@/components/accounts/properties-list-view";
import { ContactDetailView } from "@/components/accounts/contact-detail-view";
import { PropertyDetailView } from "@/components/accounts/property-detail-view";
import { fixtures } from "@/app/preview/fixtures";
import { PreviewLogSheet, PreviewToast } from "@/app/preview/preview-client";

export const dynamic = "force-dynamic";

// Screens: property-transfer-1..3, account-move, contact-move, contacts, properties, properties-stale, contact, property, property-empty, today, go, go-focus, accounts, account, log-1, log-2, log-3, log-toast, pipeline, team, approvals, me

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
    case "contacts":
      active = "/app/contacts";
      body = <ContactsListView sp={{}} rows={f.contactsList} />;
      break;
    case "properties":
      active = "/app/properties";
      body = <PropertiesListView sp={{}} rows={f.propertiesList} cities={f.propertyCities} today={f.today} />;
      break;
    case "properties-stale":
      active = "/app/properties";
      body = (
        <PropertiesListView
          sp={{ stale: "1" }}
          rows={[...f.propertiesList].filter((r) => r.roof_install_year && (r.days == null || r.days > 60)).sort((a, b) => (a.roof_install_year ?? 0) - (b.roof_install_year ?? 0))}
          cities={f.propertyCities}
          today={f.today}
        />
      );
      break;
    case "contact":
      active = "/app/contacts";
      body = <ContactDetailView d={f.contactDetail} />;
      break;
    case "property":
      active = "/app/properties";
      body = <PropertyDetailView d={f.propertyDetail} />;
      break;
    case "property-transfer-1":
    case "property-transfer-2":
    case "property-transfer-3": {
      active = "/app/properties";
      const step = Number(screen.slice(-1)) as 1 | 2 | 3;
      body = <PropertyDetailView d={f.propertyDetail} preview={{ role: "manager", step, account: step > 1 ? { id: "00000000-0000-4000-8000-000000000002", label: "RPM Living — DFW", sub: "P2 · Plano" } : null }} />;
      break;
    }
    case "account-move":
      active = "/app/accounts";
      body = (
        <AccountDetailView
          d={f.account}
          movePreview={{ step: 4, selected: f.account.props.slice(0, 2).map((p) => p.id), role: "manager", account: { id: "00000000-0000-4000-8000-000000000002", label: "RPM Living — DFW", sub: "P2 · Plano" } }}
        />
      );
      break;
    case "contact-move":
      active = "/app/contacts";
      body = <ContactDetailView d={f.contactDetail} movePreview={{ step: 2, account: { id: "00000000-0000-4000-8000-000000000004", label: "Lincoln Property Co", sub: "P1 · Dallas" }, title: "VP Facilities" }} />;
      break;
    case "property-empty":
      active = "/app/properties";
      body = <PropertyDetailView d={f.propertyEmpty} />;
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
