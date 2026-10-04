"use client";
// Admin → Team: invite / create login (temporary password shown once), manage a member (role, access, password),
// pending invites. Platform: add a company, enter a company.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  changeRole,
  createCompany,
  enterCompany,
  inviteMember,
  reassignAllAccounts,
  resendInvite,
  resetPassword,
  revokeInvite,
  setMemberActive,
  type AdminState,
} from "@/lib/actions/admin";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconCheck, IconCopy, IconKey } from "@/components/icons";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", rep: "Rep", estimator: "Estimator", pm: "PM", reviewer: "Reviewer" };

/** The one time an admin sees a temporary password. */
export function TempPasswordCard({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="region" aria-label="Temporary password" className="rounded-lg border-2 border-accent bg-accent/5 p-3">
      <p className="label text-xs text-muted">Temporary password for {email}</p>
      <div className="mt-1 flex items-center gap-2">
        <code data-testid="temp-password" className="num min-w-0 flex-1 select-all break-all font-mono text-xl font-bold tracking-wide">
          {password}
        </code>
        <button
          type="button"
          className={btn("secondary", "sm")}
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(
              () => setCopied(true),
              () => setCopied(false),
            );
            setCopied(true);
          }}
        >
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-sm">
        Shown once — copy it now and send it to them. They sign in at the login page with {email} and this password, and they&apos;ll be asked to change it.
      </p>
    </div>
  );
}

function useAdmin(initial: AdminState | null = null) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<AdminState | null>(initial);
  const { toast } = useToast();
  const router = useRouter();
  const run = (work: () => Promise<AdminState>, after?: (r: AdminState) => void) =>
    start(async () => {
      let r: AdminState;
      try {
        r = await work();
      } catch {
        r = { ok: false, error: "Couldn't save — can't reach the server." };
      }
      setState(r);
      if (r.ok) {
        if (r.message && !r.tempPassword) toast(r.message);
        after?.(r);
        router.refresh();
      }
    });
  return { pending, state, setState, run };
}

function Alert({ s }: { s: AdminState | null }) {
  if (!s || s.ok || !s.error) return null;
  return (
    <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
      {s.error}
    </p>
  );
}

export function InviteForm({ roles, tenantName, initial }: { roles: string[]; tenantName: string; initial?: AdminState }) {
  const { pending, state, setState, run } = useAdmin(initial);
  const [createLogin, setCreateLogin] = useState(true);
  return (
    <div className="flex flex-col gap-4 px-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const form = e.currentTarget;
          run(() => inviteMember(state ?? { ok: false }, fd), (r) => {
            if (r.ok) form.reset();
          });
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>
            Email <span className="text-accent">*</span>
          </span>
          <input className={input} name="email" type="email" inputMode="email" required autoComplete="off" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Name</span>
            <input className={input} name="full_name" autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Role</span>
            <select name="role" defaultValue="rep" className={cn(input, "appearance-auto")}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex min-h-12 cursor-pointer items-start gap-3">
          <input type="checkbox" name="create_login" value="1" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} className="mt-1 size-5" />
          <span>
            <span className="block font-semibold">Create login now</span>
            <span className="block text-sm text-muted">
              {createLogin
                ? "Makes their login with a temporary password you hand them. No email needed."
                : `They join ${tenantName} the first time they sign in with this email (password or emailed link).`}
            </span>
          </span>
        </label>
        <Alert s={state} />
        <button type="submit" disabled={pending} className={btn("primary", "lg", "w-full")}>
          {pending ? "Saving…" : createLogin ? "Create login" : "Send invite"}
        </button>
      </form>
      {state?.ok && state.tempPassword && state.email && (
        <div className="flex flex-col gap-2">
          <TempPasswordCard email={state.email} password={state.tempPassword} />
          <button type="button" className={btn("ghost", "sm")} onClick={() => setState(null)}>
            Done — hide it
          </button>
        </div>
      )}
    </div>
  );
}

export type ManagedMember = { user_id: string; name: string; email: string; role: string; active: boolean; ownedAccounts: number };

export function ManageMember({ m, roles, others, isSelf }: { m: ManagedMember; roles: string[]; others: { user_id: string; name: string }[]; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(m.role);
  const [reassign, setReassign] = useState<number>(0);
  const [to, setTo] = useState("");
  const { pending, state, setState, run } = useAdmin();
  return (
    <>
      <button type="button" className={btn("secondary", "sm")} onClick={() => (setState(null), setReassign(0), setOpen(true))} aria-label={`Manage ${m.name}`}>
        Manage
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={m.name} labelledBy={`manage-${m.user_id}`}>
        <div className="flex flex-col gap-5 p-4">
          <p className="text-sm text-muted">
            {m.email} · {m.active ? "Active" : "Deactivated"}
          </p>
          {isSelf ? (
            <p className="text-sm">This is you. Another owner or admin changes your role or access; your password is in Settings.</p>
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className={labelText}>Role</span>
                  <select value={role} onChange={(e) => setRole(e.target.value)} className={cn(input, "appearance-auto")} aria-label="Role">
                    {[...new Set([m.role, ...roles])].map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r] ?? r}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={pending || role === m.role} className={btn("secondary", "md")} onClick={() => run(() => changeRole({ userId: m.user_id, role }))}>
                  Change role
                </button>
              </section>

              <section className="flex flex-col gap-2">
                <span className={labelText}>Access</span>
                {m.active ? (
                  <button
                    type="button"
                    disabled={pending}
                    className={btn("danger", "md")}
                    onClick={() => {
                      if (!window.confirm(`Deactivate ${m.name}? They lose access right away. Their accounts, tasks and history stay.`)) return;
                      run(() => setMemberActive({ userId: m.user_id, active: false }), (r) => setReassign(r.ownedAccounts ?? 0));
                    }}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button type="button" disabled={pending} className={btn("secondary", "md")} onClick={() => run(() => setMemberActive({ userId: m.user_id, active: true }))}>
                    Reactivate
                  </button>
                )}
                {(reassign > 0 || (!m.active && m.ownedAccounts > 0)) && (
                  <div className="flex flex-col gap-2 rounded-lg border-2 border-warning p-3" role="region" aria-label="Reassign accounts">
                    <p className="text-sm font-semibold">
                      {m.name} still owns {reassign || m.ownedAccounts} accounts. Hand them to someone (open tasks follow):
                    </p>
                    <select value={to} onChange={(e) => setTo(e.target.value)} className={cn(input, "appearance-auto")} aria-label="Reassign to">
                      <option value="">Pick a teammate</option>
                      <option value="none">Leave unassigned</option>
                      {others.map((o) => (
                        <option key={o.user_id} value={o.user_id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !to}
                      className={btn("primary", "md")}
                      onClick={() => run(() => reassignAllAccounts({ fromUserId: m.user_id, toUserId: to === "none" ? null : to }), () => setReassign(0))}
                    >
                      Reassign accounts
                    </button>
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <span className={labelText}>Password</span>
                <button type="button" disabled={pending} className={btn("secondary", "md")} onClick={() => run(() => resetPassword({ userId: m.user_id }))}>
                  <IconKey size={18} /> Reset password
                </button>
                {state?.ok && state.tempPassword && state.email && <TempPasswordCard email={state.email} password={state.tempPassword} />}
              </section>
            </>
          )}
          <Alert s={state} />
        </div>
      </Sheet>
    </>
  );
}

export function InviteActions({ id, email }: { id: string; email: string }) {
  const { pending, state, run } = useAdmin();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button type="button" disabled={pending} className={btn("ghost", "sm")} onClick={() => run(() => resendInvite({ inviteId: id }))} aria-label={`Resend invite to ${email}`}>
          Resend
        </button>
        <button
          type="button"
          disabled={pending}
          className={btn("ghost", "sm", "text-danger")}
          onClick={() => window.confirm(`Revoke the invite for ${email}?`) && run(() => revokeInvite({ inviteId: id }))}
          aria-label={`Revoke invite to ${email}`}
        >
          Revoke
        </button>
      </div>
      {state && !state.ok && state.error && (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function CreateCompanyForm({ markets }: { markets: { slug: string; name: string; state: string }[] }) {
  const { pending, state, setState, run } = useAdmin();
  const [createLogin, setCreateLogin] = useState(true);
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4 px-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const form = e.currentTarget;
          run(() => createCompany(state ?? { ok: false }, fd), (r) => r.ok && form.reset());
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>
              Company name <span className="text-accent">*</span>
            </span>
            <input className={input} name="name" required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Short id (slug)</span>
            <input className={input} name="slug" placeholder="from the name" pattern="[a-z0-9-]*" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Time zone</span>
            <select name="timezone" defaultValue="America/Chicago" className={cn(input, "appearance-auto")}>
              <option value="America/New_York">Eastern</option>
              <option value="America/Chicago">Central</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Phoenix">Arizona</option>
              <option value="America/Los_Angeles">Pacific</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Primary market</span>
            <select name="market" defaultValue="" className={cn(input, "appearance-auto")}>
              <option value="">None yet</option>
              {markets.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}, {m.state}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>
              First owner&apos;s email <span className="text-accent">*</span>
            </span>
            <input className={input} name="owner_email" type="email" required inputMode="email" autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Owner&apos;s name</span>
            <input className={input} name="owner_name" autoComplete="off" />
          </label>
        </div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input type="checkbox" name="create_login" value="1" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} className="size-5" />
          <span>Create their login now (temporary password)</span>
        </label>
        <Alert s={state} />
        <button type="submit" disabled={pending} className={btn("primary", "lg", "w-full")}>
          {pending ? "Creating…" : "Add company"}
        </button>
      </form>
      {state?.ok && state.tenantSlug && (
        <div className="flex flex-col gap-2" role="region" aria-label="Company created">
          <p className="font-semibold">{state.message}</p>
          {state.tempPassword && state.email && <TempPasswordCard email={state.email} password={state.tempPassword} />}
          <button
            type="button"
            className={btn("secondary", "md")}
            onClick={() => {
              const slug = state.tenantSlug!;
              setState(null);
              run(() => enterCompany(slug), () => router.push("/app/today"));
            }}
          >
            Switch into it
          </button>
        </div>
      )}
    </div>
  );
}

export function EnterCompanyButton({ slug, name, current }: { slug: string; name: string; current: boolean }) {
  const { pending, run } = useAdmin();
  const router = useRouter();
  if (current) return <span className="label text-xs text-muted">Current</span>;
  return (
    <button type="button" disabled={pending} className={btn("secondary", "sm")} aria-label={`Switch into ${name}`} onClick={() => run(() => enterCompany(slug), () => router.push("/app/today"))}>
      Switch in
    </button>
  );
}
