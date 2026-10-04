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
import { MyDay } from "@/components/go/my-day";
import { AppointmentDetailView } from "@/components/appointments/appointment-detail-view";
import { ScheduleEntry } from "@/components/appointments/appt-card";
import { appointmentFixtures } from "@/app/preview/appointment-fixtures";
import { FocusSession } from "@/components/go/focus-session";
import { ContactsListView } from "@/components/accounts/contacts-list-view";
import { PropertiesListView } from "@/components/accounts/properties-list-view";
import { ContactDetailView } from "@/components/accounts/contact-detail-view";
import { PropertyDetailView } from "@/components/accounts/property-detail-view";
import { fixtures } from "@/app/preview/fixtures";
import { listsAdminPreview } from "@/app/preview/lists-admin-preview";
import { importFixtures } from "@/app/preview/fixtures-import";
import { ImportWizard } from "@/components/import/import-wizard";
import { ScorecardView } from "@/components/team/scorecard-view";
import { PreviewCardScan, PreviewLogPhotos, PreviewLogSheet, PreviewScheduleSheet, PreviewToast } from "@/app/preview/preview-client";
import { fieldKitFixtures } from "@/app/preview/field-kit-fixtures";
import { PageHeader } from "@/components/ui/bits";
import type { QueuedLog } from "@/lib/offline/types";

export const dynamic = "force-dynamic";

// Screens: today-appointments, my-day, appointment-detail, schedule-sheet, property-transfer-1..3, account-move, contact-move, contacts, properties, properties-stale, contact, property, property-empty, today, go, go-focus, accounts, account, log-1, log-2, log-3, log-toast, pipeline, team, approvals, me, import-map, import-preview, import-issues, scorecard, accounts-select

export default async function PreviewPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.DILLY_PREVIEW !== "1") notFound();
  const { screen } = await params;
  const f = fixtures();
  const manager = ["admin-team", "admin-create-login", "list-detail", "team", "approvals", "import-map", "import-preview", "import-issues", "scorecard", "accounts-select"].includes(screen);
  const session = manager ? { ...f.session, fullName: "Tyler Fox", email: "tyler@foxroofing.co", tenant: { ...f.session.tenant, role: "manager" } } : f.session;

  let body: React.ReactNode;
  let active = "/app/today";
  let queuePreview: QueuedLog[] | undefined;
  const fk = fieldKitFixtures(f.today, f.austinStops);
  const ap = appointmentFixtures(f.today, f.austinStops);
  const myDay = (stops = ap.stops, route = false) => (
    <>
      <PageHeader title="My day" />
      <MyDay appointments={ap.appts} stops={stops} listTitle="Suggested stops · Austin" callHref="/app/go?mode=calls" initialRoute={route} />
    </>
  );
  switch (screen) {
    case "today":
      body = <TodayView d={f.todayData} />;
      break;
    case "today-appointments":
      body = <TodayView d={{ ...f.todayData, appointments: ap.appts }} />;
      break;
    case "go":
    case "my-day":
      active = "/app/go";
      body = myDay();
      break;
    case "appointment-detail":
      body = <AppointmentDetailView a={ap.detail} google={ap.google} today={f.today} />;
      break;
    case "schedule-sheet":
      active = "/app/accounts";
      body = (
        <>
          <AccountDetailView d={f.account} schedule={<ScheduleEntry target={{ accountId: f.account.id }} appointments={ap.appts.upcoming.slice(0, 1)} label="Schedule a visit" />} />
          <PreviewScheduleSheet initial={ap.schedule} />
        </>
      );
      break;
    case "go-focus":
      active = "/app/go";
      body = (
        <>
          <PageHeader title="Call through the list" />
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
    case "import-map":
    case "import-preview":
    case "import-issues": {
      active = "/app/accounts";
      const x = importFixtures(f.today);
      body = (
        <ImportWizard
          tenantName="The Service Group"
          year={Number(f.today.slice(0, 4))}
          members={x.members}
          me={x.me}
          saved={[]}
          recent={[]}
          entity="accounts"
          initial={{ step: screen === "import-map" ? "map" : "preview", text: x.text, fileName: "tsg-import-sample.csv", index: x.index, tab: screen === "import-issues" ? "issues" : undefined }}
        />
      );
      break;
    }
    case "scorecard":
      active = "/app/team";
      body = <ScorecardView sc={importFixtures(f.today).scorecard} tenantName="FOX Roofing" />;
      break;
    case "accounts-select":
      active = "/app/accounts";
      body = (
        <AccountsListView
          sp={{}}
          scope="all"
          q=""
          data={f.accounts.map((a, i) => ({ ...a, owner_name: ["Colby Remedios", "Kayla Smiley", null][i % 3] }))}
          manager={{
            members: [
              { user_id: "u1", name: "Colby Remedios", role: "rep" },
              { user_id: "u2", name: "Kayla Smiley", role: "rep" },
              { user_id: "u3", name: "Tyler Fox", role: "manager" },
            ],
            selecting: true,
            selected: f.accounts.slice(0, 3).map((a) => a.id!).filter(Boolean),
          }}
        />
      );
      break;
    case "me":
      active = "/app/me";
      body = <MeView d={f.me} />;
      break;
    // --- Field kit ---------------------------------------------------------------------------------------
    case "log-photos":
      body = (
        <>
          <TodayView d={f.todayData} />
          <PreviewLogPhotos data={f.logData} contact={f.logContacts[0]} />
        </>
      );
      break;
    case "property-photos":
      active = "/app/properties";
      body = <PropertyDetailView d={{ ...f.propertyDetail, photos: fk.photos }} />;
      break;
    case "card-scan":
      active = "/app/contacts";
      body = (
        <div>
          <PageHeader back="/app/go" title="Add person I met" sub="We check for the same person before saving." />
          <div className="px-4 pt-2">
            <PreviewCardScan preview={fk.card} />
          </div>
        </div>
      );
      break;
    case "go-route":
      active = "/app/go";
      body = myDay(fk.routeStops.map((s) => ({ ...s, key: s.propertyId ?? s.accountId })), true);
      break;
    case "offline-queued":
      active = "/app/go";
      queuePreview = fk.queued;
      body = (
        <>
          {myDay(fk.routeStops.map((s) => ({ ...s, key: s.propertyId ?? s.accountId })))}
          <PreviewToast text="Saved on this phone · Waiting for signal · 2 queued" />
        </>
      );
      break;
    default: {
      const la = listsAdminPreview(screen, f);
      if (!la) notFound();
      body = la.body;
      active = la.active;
    }
  }

  return (
    <AppShell
      tenant={session.tenant}
      tenants={session.tenants}
      fullName={session.fullName}
      email={session.email}
      isManager={manager}
      activeHref={active}
      queuePreview={queuePreview}
      userId="00000000-0000-4000-8000-000000000001"
    >
      {body}
    </AppShell>
  );
}
