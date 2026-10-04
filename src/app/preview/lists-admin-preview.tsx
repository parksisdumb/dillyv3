// Preview screens for lists, active pursuit and admin (fixture data). Wired from /preview/[screen].
// Screens: admin-team, admin-create-login, lists, list-detail, properties-active
import type { PropertyListRow } from "@/lib/server/book";
import { PropertiesListView } from "@/components/accounts/properties-list-view";
import { ListsIndex } from "@/components/lists/lists-index";
import { ListDetailView } from "@/components/lists/list-detail-view";
import { AdminChrome, adminSections } from "@/components/admin/admin-chrome";
import { AdminTeamView } from "@/components/admin/admin-team-view";
import type { MemberRow } from "@/lib/server/admin";

type F = { today: string; propertiesList: PropertyListRow[]; propertyCities: { city: string; n: number }[] };

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const MEMBERS: MemberRow[] = [
  { user_id: "u-parks", name: "Parks Flowers", email: "team@dillyos.com", role: "owner", active: true, lastSignInAt: ago(0.2), lastTouchAt: ago(20), activeProperties: 4, pointsWeek: 118, ownedAccounts: 12 },
  { user_id: "u-morgan", name: "Morgan Hale", email: "morgan@thesvcgroup.com", role: "rep", active: true, lastSignInAt: ago(3), lastTouchAt: ago(1), activeProperties: 11, pointsWeek: 342, ownedAccounts: 38 },
  { user_id: "u-jalen", name: "Jalen Brooks", email: "jalen@thesvcgroup.com", role: "rep", active: true, lastSignInAt: ago(26), lastTouchAt: ago(30), activeProperties: 6, pointsWeek: 190, ownedAccounts: 21 },
  { user_id: "u-dee", name: "Dee Castillo", email: "dee@thesvcgroup.com", role: "manager", active: true, lastSignInAt: ago(50), lastTouchAt: null, activeProperties: 0, pointsWeek: 0, ownedAccounts: 0 },
  { user_id: "u-old", name: "Sam Ortiz", email: "sam@thesvcgroup.com", role: "rep", active: false, lastSignInAt: ago(400), lastTouchAt: ago(420), activeProperties: 0, pointsWeek: 0, ownedAccounts: 7 },
];

function admin(body: React.ReactNode) {
  return (
    <AdminChrome tenantName="The Service Group" readonly={false} sections={adminSections("admin", true)} current="/app/admin/team">
      {body}
    </AdminChrome>
  );
}

const teamData = {
  tenantName: "The Service Group",
  userId: "u-parks",
  editable: true,
  roles: ["owner", "admin", "manager", "rep", "estimator", "pm", "reviewer"],
  members: MEMBERS,
  invites: [{ id: "00000000-0000-4000-8000-0000000000a1", email: "taylor@thesvcgroup.com", role: "rep", full_name: "Taylor Reese", created_at: ago(30) }],
  audit: [
    { id: "a1", action: "member.login_created", actor: "Parks Flowers", target: "Jalen Brooks", before: null, after: { role: "rep" }, created_at: ago(5) },
    { id: "a2", action: "member.deactivated", actor: "Parks Flowers", target: "Sam Ortiz", before: { active: true }, after: { active: false }, created_at: ago(28) },
    { id: "a3", action: "member.role_changed", actor: "Parks Flowers", target: "Dee Castillo", before: { role: "rep" }, after: { role: "manager" }, created_at: ago(72) },
  ],
};

export function listsAdminPreview(screen: string, f: F): { body: React.ReactNode; active: string; manager: boolean } | null {
  const rows = f.propertiesList;
  switch (screen) {
    case "admin-team":
      return { body: admin(<AdminTeamView d={teamData} />), active: "/app/team", manager: true };
    case "admin-create-login":
      return {
        body: admin(<AdminTeamView d={{ ...teamData, inviteState: { ok: true, message: "Login created", email: "riley@thesvcgroup.com", tempPassword: "Kq7m-Rt3p-9xWd-Fh2a" } }} />),
        active: "/app/team",
        manager: true,
      };
    case "properties-active":
      return {
        body: <PropertiesListView sp={{ tab: "active" }} rows={rows.slice(0, 5)} cities={[]} today={f.today} tab="active" activeCount={5} activeIds={new Set(rows.slice(0, 5).map((r) => r.id))} />,
        active: "/app/properties",
        manager: false,
      };
    case "lists":
      return {
        body: (
          <PropertiesListView
            sp={{ tab: "lists" }}
            rows={[]}
            cities={[]}
            today={f.today}
            tab="lists"
            activeCount={5}
            listsPanel={
              <ListsIndex
                groups={[
                  { title: "Assigned to you", lists: [{ id: "l1", name: "Germantown PMCs — walk this week", kind: "static", createdFrom: "filter", n: 14, sub: "by Parks" }] },
                  { title: "Your lists", lists: [{ id: "l2", name: "Poplar Ave corridor", kind: "smart", createdFrom: "filter", n: 23 }] },
                  { title: "Team lists", lists: [] },
                  {
                    title: "Built-in",
                    lists: [
                      { id: "s1", name: "Oldest roofs · quiet 60 days", kind: "smart", createdFrom: "system", n: 31 },
                      { id: "s2", name: "Warranty ending in 12 months", kind: "smart", createdFrom: "system", n: 6 },
                      { id: "s3", name: "Open leaks & damage", kind: "smart", createdFrom: "system", n: 3 },
                      { id: "s4", name: "New management (90 days)", kind: "smart", createdFrom: "system", n: 4 },
                      { id: "s5", name: "Never touched", kind: "smart", createdFrom: "system", n: 118, capped: false },
                      { id: "s6", name: "Storm hit (30 days)", kind: "smart", createdFrom: "system", n: 0 },
                    ],
                  },
                  { title: "Imports", lists: [{ id: "i1", name: "Import — memphis-book.csv — Oct 5, 2026", kind: "static", createdFrom: "import", n: 212 }] },
                ]}
              />
            }
          />
        ),
        active: "/app/properties",
        manager: false,
      };
    case "list-detail":
      return {
        body: (
          <ListDetailView
            d={{
              list: { id: "00000000-0000-4000-8000-0000000000l1", name: "Germantown PMCs — walk this week", description: "Older TPO and mod-bit roofs managed by the big PMCs.", kind: "static", createdFrom: "filter", filter: {}, visibility: "team", archived: false },
              summary: [],
              rows: rows.slice(0, 8),
              total: 8,
              capped: false,
              error: null,
              progress: { touched: rows.slice(0, 8).filter((r) => r.days != null && r.days <= 30).length, total: 8 },
              today: f.today,
              sort: "list",
              selecting: false,
              canEdit: true,
              isManager: true,
              activeIds: rows.slice(0, 2).map((r) => r.id),
              assigned: ["u-morgan", "u-jalen"],
              assignedNames: ["Morgan Hale", "Jalen Brooks"],
              members: MEMBERS.filter((m) => m.active).map((m) => ({ user_id: m.user_id, name: m.name, role: m.role })),
            }}
          />
        ),
        active: "/app/properties",
        manager: true,
      };
  }
  return null;
}
