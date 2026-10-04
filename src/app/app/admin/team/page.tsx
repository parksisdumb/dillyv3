import type { Metadata } from "next";
import { pageBody } from "@/components/status/page-boundary";
import { adminCtx, loadAudit, loadMemberRows, loadPendingInvites } from "@/lib/server/admin";
import { safe } from "@/lib/server/safe";
import { assignableRoles } from "@/lib/domain/admin";
import { AdminTeamView } from "@/components/admin/admin-team-view";

export const metadata: Metadata = { title: "Admin · Team" };

async function TeamAdminBody() {
  const c = await adminCtx("readonly");
  const f = { tenant: c.tenantId };
  const editable = c.level === "admin";
  const [members, invites, audit] = await Promise.all([
    safe(() => loadMemberRows(c), [], "admin:members", f),
    safe(() => loadPendingInvites(c), [], "admin:invites", f),
    editable ? safe(() => loadAudit(c), [], "admin:audit", f) : Promise.resolve([]),
  ]);
  return <AdminTeamView d={{ tenantName: c.s.tenant.name, userId: c.s.userId, editable, roles: assignableRoles(c.actor), members, invites, audit }} />;
}

export default function TeamAdminPage() {
  return pageBody(() => TeamAdminBody());
}
