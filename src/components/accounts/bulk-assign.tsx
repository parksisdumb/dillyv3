"use client";
// Manager tools on the Accounts list (multi-select + action bar) and the account page (Assign).
// Reps never get these: the server only renders them for owners/admins/managers, and the RPC checks the role again.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bulkUpdateAccounts, type BulkResult } from "@/lib/actions/assign";
import { PREFERENCES } from "@/lib/domain/vocab";
import { AccountRow, type AccountRowData } from "@/components/accounts/account-row";
import { Sheet } from "@/components/ui/sheet";
import { Chip, StateChip, TierPill } from "@/components/ui/bits";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { HideLogFab } from "@/components/log/log-provider";
import { IconUser } from "@/components/icons";

export type TeamMember = { user_id: string; name: string; role: string };
export type BulkRow = AccountRowData & { owner_name?: string | null };

type Pending = "assign" | "tier" | "preference" | null;

const TASKS_FOLLOW = "Open tasks on these accounts that belong to the previous owner (or nobody) move to the new owner. Tasks a teammate is holding stay with them.";

/** Run a bulk change: toast, refresh, report. */
function useBulk(onDone: () => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const run = (input: Parameters<typeof bulkUpdateAccounts>[0]) =>
    start(async () => {
      setError(null);
      let r: BulkResult;
      try {
        r = await bulkUpdateAccounts(input);
      } catch {
        r = { ok: false, error: "Couldn't save — can't reach the server. Check your signal and try again." };
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.message);
      onDone();
      router.refresh();
    });
  return { pending, error, run, setError };
}

export function AssignPicker({
  members,
  currentOwnerId,
  pending,
  onPick,
}: {
  members: TeamMember[];
  currentOwnerId?: string | null;
  pending: boolean;
  onPick: (userId: string | null) => void;
}) {
  return (
    <ul className="divide-y divide-line" aria-label="Team">
      {members.map((m) => (
        <li key={m.user_id}>
          <button
            type="button"
            disabled={pending}
            onClick={() => onPick(m.user_id)}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2 disabled:opacity-50"
          >
            <IconUser size={20} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{m.name}</span>
              <span className="label block text-xs text-muted">{m.role}</span>
            </span>
            {currentOwnerId === m.user_id && <Chip>Current</Chip>}
          </button>
        </li>
      ))}
      <li>
        <button type="button" disabled={pending} onClick={() => onPick(null)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-muted hover:bg-surface-2">
          <span className="min-w-0 flex-1 font-semibold">Unassigned</span>
          {currentOwnerId === null && <Chip>Current</Chip>}
        </button>
      </li>
    </ul>
  );
}

function TierPicker({ pending, onPick }: { pending: boolean; onPick: (t: number) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 p-4">
      {[1, 2, 3, 4].map((t) => (
        <button key={t} type="button" disabled={pending} onClick={() => onPick(t)} className={btn("secondary", "lg")} aria-label={`Priority P${t}`}>
          P{t}
        </button>
      ))}
    </div>
  );
}

function PreferencePicker({ pending, error, onPick }: { pending: boolean; error: string | null; onPick: (p: string, reason?: string) => void }) {
  const [pref, setPref] = useState("pursue");
  const [reason, setReason] = useState("");
  const needsReason = pref === "do_not_pursue" || pref === "competitor";
  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onPick(pref, reason.trim() || undefined);
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Preference</span>
        <select className={cn(input, "appearance-auto")} value={pref} onChange={(e) => setPref(e.target.value)}>
          {Object.entries(PREFERENCES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label} — {v.hint}
            </option>
          ))}
          <option value="none">Clear preference</option>
        </select>
      </label>
      {pref !== "none" && (
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>
            Reason{needsReason && <span className="text-accent"> *</span>}
          </span>
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needsReason ? "The team sees this on each account" : "Optional"} required={needsReason} />
        </label>
      )}
      {error && (
        <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={btn("primary", "lg", "w-full")}>
        {pending ? "Saving…" : "Apply"}
      </button>
    </form>
  );
}

/**
 * Accounts list for managers: the normal rows, plus a Select mode with checkboxes and a bottom action bar
 * (Assign to rep · Set tier · Set preference). Import / Export live in the same toolbar.
 */
export function BulkAccountsList({
  rows,
  members,
  exportHref,
  capped,
  initialSelecting = false,
  initialSelected = [],
}: {
  rows: BulkRow[];
  members: TeamMember[];
  exportHref: string;
  capped?: boolean;
  initialSelecting?: boolean;
  initialSelected?: string[];
}) {
  const [selecting, setSelecting] = useState(initialSelecting);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [sheet, setSheet] = useState<Pending>(null);
  const ids = useMemo(() => rows.map((r) => r.id).filter((x): x is string => !!x), [rows]);
  const done = () => {
    setSheet(null);
    setSelected(new Set());
    setSelecting(false);
  };
  const { pending, error, run, setError } = useBulk(done);
  const n = selected.size;
  const allOn = n > 0 && ids.every((i) => selected.has(i));
  const toggle = (id: string) =>
    setSelected((s) => {
      const x = new Set(s);
      if (x.has(id)) x.delete(id);
      else x.add(id);
      return x;
    });
  const open = (p: Pending) => {
    setError(null);
    setSheet(p);
  };
  const picked = [...selected];

  return (
    <>
      <div className="mt-2 flex min-h-12 items-center gap-2 px-4">
        {selecting ? (
          <>
            <button type="button" className={btn("ghost", "sm", "-ml-3")} onClick={() => setSelected(allOn ? new Set() : new Set(ids))}>
              {allOn ? "Clear all" : `Select all ${ids.length}${capped ? "+" : ""}`}
            </button>
            <span className="num ml-auto text-sm text-muted" aria-live="polite">
              {n} selected
            </span>
            <button type="button" className={btn("secondary", "sm")} onClick={done}>
              Done
            </button>
          </>
        ) : (
          <>
            <span className="num text-sm text-muted">
              {rows.length}
              {capped ? "+" : ""} accounts
            </span>
            <span className="ml-auto flex gap-2">
              <Link href="/app/import?entity=accounts" className={btn("ghost", "sm")}>
                Import
              </Link>
              <a href={exportHref} className={btn("ghost", "sm")} download>
                Export
              </a>
              <button type="button" className={btn("secondary", "sm")} onClick={() => setSelecting(true)} disabled={rows.length === 0}>
                Select
              </button>
            </span>
          </>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="mt-1 divide-y divide-line border-y border-line bg-surface">
          {selecting
            ? rows.map((a) => {
                const on = !!a.id && selected.has(a.id);
                return (
                  <li key={a.id} className={cn(on && "bg-accent/8")}>
                    <label className="flex min-h-16 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-6 shrink-0 accent-[var(--accent)]"
                        checked={on}
                        onChange={() => a.id && toggle(a.id)}
                        aria-label={`Select ${a.name}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <TierPill tier={a.icp_tier} />
                          <span className="truncate font-display text-base font-bold">{a.name}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                          <StateChip state={a.relationship_state} />
                          {a.city && <span>{a.city}</span>}
                          {a.owner_name !== undefined && <span>· {a.owner_name ?? "Unassigned"}</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })
            : rows.map((a) => <AccountRow key={a.id} a={a} />)}
        </ul>
      )}

      {selecting && (
        <>
          <HideLogFab />
          <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t-2 border-ink bg-surface shadow-2xl" role="toolbar" aria-label="Bulk actions">
            <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
              <span className="num mr-auto font-display text-lg font-bold">{n} selected</span>
              <button type="button" className={btn("primary", "sm")} disabled={n === 0} onClick={() => open("assign")}>
                Assign
              </button>
              <button type="button" className={btn("secondary", "sm")} disabled={n === 0} onClick={() => open("tier")}>
                Tier
              </button>
              <button type="button" className={btn("secondary", "sm")} disabled={n === 0} onClick={() => open("preference")}>
                Preference
              </button>
            </div>
          </div>
        </>
      )}

      <Sheet open={sheet === "assign"} onClose={() => setSheet(null)} title={`Assign ${n} ${n === 1 ? "account" : "accounts"}`} labelledBy="bulk-assign-title">
        <p className="px-4 pt-3 text-sm text-muted">{TASKS_FOLLOW}</p>
        {error && <p role="alert" className="mx-4 mt-2 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">{error}</p>}
        <AssignPicker members={members} pending={pending} onPick={(u) => run({ accountIds: picked, ownerUserId: u })} />
      </Sheet>
      <Sheet open={sheet === "tier"} onClose={() => setSheet(null)} title={`Set tier on ${n}`} labelledBy="bulk-tier-title">
        {error && <p role="alert" className="mx-4 mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">{error}</p>}
        <TierPicker pending={pending} onPick={(t) => run({ accountIds: picked, tier: t })} />
      </Sheet>
      <Sheet open={sheet === "preference"} onClose={() => setSheet(null)} title={`Set preference on ${n}`} labelledBy="bulk-pref-title">
        <PreferencePicker pending={pending} error={error} onPick={(p, reason) => run({ accountIds: picked, preference: p, reason })} />
      </Sheet>
    </>
  );
}

/** "Assign" on the account page (managers). */
export function AssignOwnerButton({
  accountId,
  ownerId,
  ownerName,
  members,
  lastChange,
}: {
  accountId: string;
  ownerId: string | null;
  ownerName: string | null;
  members: TeamMember[];
  lastChange?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useBulk(() => setOpen(false));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("secondary", "sm", "min-h-10 px-3")}>
        {ownerId ? "Reassign" : "Assign"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={ownerName ? `Owner: ${ownerName}` : "Assign an owner"} labelledBy="assign-owner-title">
        <p className="px-4 pt-3 text-sm text-muted">{TASKS_FOLLOW.replace("these accounts", "this account")}</p>
        {lastChange && <p className="px-4 pt-1 text-xs text-muted">{lastChange}</p>}
        {error && <p role="alert" className="mx-4 mt-2 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">{error}</p>}
        <AssignPicker members={members} currentOwnerId={ownerId} pending={pending} onPick={(u) => run({ accountIds: [accountId], ownerUserId: u })} />
      </Sheet>
    </>
  );
}
