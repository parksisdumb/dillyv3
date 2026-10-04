import type { AuditRow, InviteRow, MemberRow } from "@/lib/server/admin";
import { agoLabel } from "@/lib/format";
import { Chip, SectionTitle } from "@/components/ui/bits";
import { cn } from "@/components/ui/styles";
import { InviteActions, InviteForm, ManageMember } from "@/components/admin/team-admin";
import type { AdminState } from "@/lib/actions/admin";

const AUDIT: Record<string, string> = {
  "member.login_created": "created a login for",
  "member.added": "added",
  "member.role_changed": "changed the role of",
  "member.deactivated": "deactivated",
  "member.reactivated": "reactivated",
  "member.password_reset": "reset the password of",
  "member.accounts_reassigned": "reassigned the accounts of",
  "invite.created": "invited",
  "invite.revoked": "revoked the invite for",
  "invite.resent": "resent the invite to",
  "company.updated": "updated the company",
  "company.reminders": "changed reminder rules",
  "company.market_added": "added a market",
  "company.market_removed": "removed a market",
  "company.market_role": "changed a market",
  "company.created": "created the company",
};

function change(before: unknown, after: unknown): string {
  const b = before && typeof before === "object" ? (before as Record<string, unknown>) : null;
  const a = after && typeof after === "object" ? (after as Record<string, unknown>) : null;
  if (b?.role && a?.role) return ` (${b.role} → ${a.role})`;
  if (a?.role) return ` as ${a.role}`;
  return "";
}

function lastActive(a: string | null, b: string | null): string {
  const t = [a, b].filter((x): x is string => !!x).sort((x, y) => Date.parse(y) - Date.parse(x))[0];
  return t ? agoLabel(t) : "never";
}

export type AdminTeamData = {
  tenantName: string;
  userId: string;
  editable: boolean;
  roles: string[];
  members: MemberRow[];
  invites: InviteRow[];
  audit: AuditRow[];
  /** Preview only: the invite form's last result (e.g. a temporary password on screen). */
  inviteState?: AdminState;
};

/** Admin → Team: members, add someone (invite / create login), pending invites, recent changes. */
export function AdminTeamView({ d }: { d: AdminTeamData }) {
  const { members, invites, audit, roles, editable } = d;
  const others = members.filter((m) => m.active).map((m) => ({ user_id: m.user_id, name: m.name }));
  return (
    <div>
      <SectionTitle>Members · {members.filter((m) => m.active).length} active</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface" aria-label="Members">
        {members.map((m) => (
          <li key={m.user_id} className={cn("flex items-center gap-3 px-4 py-3", !m.active && "opacity-70")}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold">{m.name}</span>
                <Chip tone={m.role === "owner" || m.role === "admin" ? "ink" : "neutral"}>{m.role}</Chip>
                {!m.active && <Chip tone="bad">Deactivated</Chip>}
              </div>
              <div className="truncate text-sm text-muted">{m.email}</div>
              <div className="num mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                <span>Last active {lastActive(m.lastSignInAt, m.lastTouchAt)}</span>
                <span>{m.activeProperties} active properties</span>
                <span>{m.pointsWeek} pts this week</span>
                {m.ownedAccounts > 0 && <span>{m.ownedAccounts} accounts</span>}
              </div>
            </div>
            {editable && <ManageMember m={m} roles={roles} others={others.filter((o) => o.user_id !== m.user_id)} isSelf={m.user_id === d.userId} />}
          </li>
        ))}
      </ul>

      {editable && (
        <>
          <SectionTitle>Add someone</SectionTitle>
          <div className="border-y border-line bg-surface py-4">
            <InviteForm roles={roles} tenantName={d.tenantName} initial={d.inviteState} />
          </div>
        </>
      )}

      <SectionTitle>Pending invites · {invites.length}</SectionTitle>
      {invites.length === 0 ? (
        <p className="px-4 text-sm text-muted">None — everyone invited has signed in.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface" aria-label="Pending invites">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{i.full_name ?? i.email}</div>
                <div className="truncate text-sm text-muted">
                  {i.email} · <span className="label">{i.role}</span> · invited {agoLabel(i.created_at)}
                </div>
              </div>
              {editable && <InviteActions id={i.id} email={i.email} />}
            </li>
          ))}
        </ul>
      )}

      {editable && audit.length > 0 && (
        <>
          <SectionTitle>Recent changes</SectionTitle>
          <ul className="divide-y divide-line border-y border-line bg-surface text-sm" aria-label="Recent changes">
            {audit.map((a) => (
              <li key={a.id} className="px-4 py-2">
                <span className="font-semibold">{a.actor}</span> {AUDIT[a.action] ?? a.action} {a.target && <span className="font-semibold">{a.target}</span>}
                {change(a.before, a.after)} <span className="text-muted">· {agoLabel(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
