"use client";
// Property detail: current owner / manager, history, and the change flow (pick company → people → confirm).
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { quickCreateAccount, searchAccountOptions, type PickOption } from "@/lib/actions/book";
import { transferProperty } from "@/lib/actions/ownership";
import { PARTY_ROLES, oppsThatMove, staysWithBuilding, tenureLabel, transferSummary, type OppForTransfer, type PartyRole } from "@/lib/domain/ownership";
import { SearchPicker } from "@/components/ui/search-picker";
import { Sheet } from "@/components/ui/sheet";
import { SectionTitle } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconBuilding, IconChevronDown, IconHistory, IconSwap } from "@/components/icons";

export type PartyRow = {
  id: string;
  role: PartyRole;
  account_id: string;
  account_name: string;
  started_on: string | null;
  ended_on: string | null;
  source: string;
  note: string | null;
};

export type SheetPerson = { id: string; name: string; title: string | null; persona_role: string; account_id: string | null };

export type OwnershipData = {
  propertyId: string;
  propertyName: string;
  accountId: string | null;
  today: string;
  history: PartyRow[];
  people: SheetPerson[];
  opps: OppForTransfer[];
  touches: number;
};

export type TransferPreview = { role: PartyRole; step: 1 | 2 | 3; account?: PickOption | null; sides?: Record<string, Side> };

type Side = "building" | "old";

const ROLE_ORDER: PartyRole[] = ["manager", "owner", "asset_manager", "tenant_occupant"];

export function OwnershipSection({ d, preview }: { d: OwnershipData; preview?: TransferPreview }) {
  const [open, setOpen] = useState<PartyRole | null>(preview?.role ?? null);
  const current = useMemo(() => new Map(d.history.filter((h) => !h.ended_on).map((h) => [h.role, h])), [d.history]);
  const past = d.history.filter((h) => h.ended_on).sort((a, b) => (b.ended_on ?? "").localeCompare(a.ended_on ?? ""));
  const roles = ROLE_ORDER.filter((r) => r === "manager" || r === "owner" || current.has(r));

  return (
    <section aria-label="Ownership and management">
      <SectionTitle>Ownership &amp; management</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface">
        {roles.map((r) => {
          const c = current.get(r);
          return (
            <li key={r} className="flex min-h-16 items-center gap-3 py-2 pl-4 pr-2">
              <div className="min-w-0 flex-1">
                <div className={labelText}>{PARTY_ROLES[r].label}</div>
                {c ? (
                  <>
                    <Link href={`/app/accounts/${c.account_id}`} className="flex min-h-11 max-w-full items-center truncate font-display text-base font-bold underline decoration-line underline-offset-2">
                      {c.account_name}
                    </Link>
                    <div className="truncate text-xs text-muted">{tenureLabel(c.started_on, null)}</div>
                  </>
                ) : (
                  <div className="text-sm text-muted">Not recorded</div>
                )}
              </div>
              <button type="button" onClick={() => setOpen(r)} className={btn("secondary", "sm", "shrink-0")} aria-label={`${c ? "Change" : "Set"} ${PARTY_ROLES[r].noun}`}>
                <IconSwap size={16} /> {c ? "Change" : "Set"}
              </button>
            </li>
          );
        })}
      </ul>
      {past.length > 0 && (
        <details className="group mx-4 mt-2 rounded-lg border-2 border-line bg-surface">
          <summary className="label flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-xs text-muted [&::-webkit-details-marker]:hidden">
            <IconHistory size={16} /> History · {past.length} earlier
            <IconChevronDown size={16} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <ol className="border-t border-line px-3 py-2">
            {[...d.history]
              .sort((a, b) => Number(!!a.ended_on) - Number(!!b.ended_on) || (b.ended_on ?? b.started_on ?? "").localeCompare(a.ended_on ?? a.started_on ?? ""))
              .map((h) => (
                <li key={h.id} className="relative border-l-2 border-line py-2 pl-4">
                  <span className={cn("absolute -left-[7px] top-3.5 size-3 rounded-full border-2 border-surface", h.ended_on ? "bg-line" : "bg-accent")} aria-hidden="true" />
                  <div className="flex items-baseline gap-2">
                    <Link href={`/app/accounts/${h.account_id}`} className="flex min-h-11 min-w-0 flex-1 items-center truncate font-semibold">
                      {h.account_name}
                    </Link>
                    <span className="label shrink-0 text-xs text-muted">{PARTY_ROLES[h.role].label}</span>
                  </div>
                  <div className="text-sm text-muted">
                    {tenureLabel(h.started_on, h.ended_on)}
                    {!h.ended_on && " · current"}
                  </div>
                  {h.note && <div className="text-sm">{h.note}</div>}
                </li>
              ))}
          </ol>
        </details>
      )}
      {open && <TransferSheet d={d} role={open} current={current.get(open) ?? null} manager={current.get("manager") ?? null} onClose={() => setOpen(null)} preview={preview?.role === open ? preview : undefined} />}
    </section>
  );
}

/** Two-column-in-one-list sorter: who goes with the building, who stays with the old company. Tap flips. */
export function PeopleSorter({
  people,
  sides,
  onFlip,
  newName,
  oldName,
}: {
  people: SheetPerson[];
  sides: Record<string, Side>;
  onFlip: (id: string) => void;
  newName: string;
  oldName: string;
}) {
  const group = (side: Side) => people.filter((p) => sides[p.id] === side);
  const block = (side: Side, title: string, sub: string) => {
    const rows = group(side);
    return (
      <div>
        <div className="px-4 pb-1 pt-3">
          <div className="font-display text-base font-bold">
            {title} <span className="num text-muted">· {rows.length}</span>
          </div>
          <div className="text-xs text-muted">{sub}</div>
        </div>
        {rows.length === 0 ? (
          <p className="mx-4 rounded-lg border-2 border-dashed border-line px-3 py-3 text-sm text-muted">Nobody. Tap a person below to move them here.</p>
        ) : (
          <ul className="mx-4 divide-y divide-line overflow-hidden rounded-lg border-2 border-line">
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onFlip(p.id)} className="flex min-h-14 w-full items-center gap-3 bg-surface px-3 py-2 text-left hover:bg-surface-2" aria-label={`${p.name}: ${side === "building" ? `moves to ${newName}` : `stays with ${oldName}`}. Tap to switch.`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block truncate text-sm text-muted">{p.title ?? " "}</span>
                  </span>
                  <span className="label inline-flex shrink-0 items-center gap-1 text-xs text-accent">
                    <IconSwap size={14} /> Switch
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <div>
      {block("building", "Stays with the building", `Becomes ${newName} staff`)}
      {block("old", `Stays with ${oldName}`, "Keeps their company; unlinked from this building")}
    </div>
  );
}

export function defaultSides(people: SheetPerson[]): Record<string, Side> {
  return Object.fromEntries(people.map((p) => [p.id, staysWithBuilding(p.title, p.persona_role) ? "building" : "old"]));
}

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="label flex items-center gap-2 px-4 pt-3 text-xs text-muted">
      Step {step} of {total}
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-6 rounded-full", i < step ? "bg-accent" : "bg-line")} />
        ))}
      </span>
    </div>
  );
}

function TransferSheet({
  d,
  role,
  current,
  manager,
  onClose,
  preview,
}: {
  d: OwnershipData;
  role: PartyRole;
  current: PartyRow | null;
  manager: PartyRow | null;
  onClose: () => void;
  preview?: TransferPreview;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const oldName = current?.account_name ?? null;
  // People who could move: linked to this building and employed by the company being replaced.
  const candidates = useMemo(() => (current ? d.people.filter((p) => p.account_id === current.account_id) : []), [d.people, current]);
  const total = candidates.length ? 3 : 2;
  const [step, setStep] = useState<number>(Math.min(preview?.step ?? 1, total));
  const [account, setAccount] = useState<PickOption | null>(preview?.account ?? null);
  const [effective, setEffective] = useState(d.today);
  const [sides, setSides] = useState<Record<string, Side>>(() => ({ ...defaultSides(candidates), ...(preview?.sides ?? {}) }));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const same = !!account && account.id === current?.account_id;
  const withBuilding = candidates.filter((p) => sides[p.id] === "building").map((p) => p.id);
  const withOld = candidates.filter((p) => sides[p.id] === "old").map((p) => p.id);
  const moving = account ? oppsThatMove({ role, accountId: d.accountId, currentManagerId: manager?.account_id ?? null, newAccountId: account.id, opps: d.opps }) : [];
  const openOpps = d.opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const summary = account
    ? transferSummary({
        propertyName: d.propertyName,
        role,
        newName: account.label,
        oldName,
        withBuilding: withBuilding.length,
        withOldCompany: withOld.length,
        movingOpps: moving,
        stayingOppCount: openOpps.length,
        buyerName: manager?.account_name ?? null,
        touches: d.touches,
      })
    : [];
  const confirmStep = total;

  const submit = () =>
    start(async () => {
      if (!account) return;
      setError(null);
      const r = await transferProperty({
        propertyId: d.propertyId,
        role,
        newAccountId: account.id,
        effective,
        withBuilding,
        withOldCompany: withOld,
        note: note || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(`${d.propertyName}: ${PARTY_ROLES[role].noun} is now ${account.label}. Intro task is in your queue.`);
      onClose();
      router.refresh();
    });

  return (
    <Sheet open onClose={onClose} title={current ? PARTY_ROLES[role].change : `Set ${PARTY_ROLES[role].noun}`} labelledBy="transfer-title">
      <StepDots step={step} total={total} />
      {step === 1 && (
        <div className="flex flex-col gap-4 px-4 pb-2 pt-3">
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
            <IconBuilding size={20} className="shrink-0 text-muted" />
            <div className="min-w-0 text-sm">
              <div className="truncate font-semibold">{d.propertyName}</div>
              <div className="truncate text-muted">
                {PARTY_ROLES[role].label} now: {oldName ?? "not recorded"}
              </div>
            </div>
          </div>
          <SearchPicker
            name="new_account"
            label={`New ${PARTY_ROLES[role].noun === "management" ? "management company" : PARTY_ROLES[role].noun}`}
            search={searchAccountOptions}
            create={quickCreateAccount}
            initial={account}
            onChange={setAccount}
            placeholder="Company name"
            hint="Not in Dilly yet? Type the name and tap Create."
            required
          />
          {same && <p className="text-sm text-danger">{account?.label} is already the {PARTY_ROLES[role].noun} here.</p>}
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Effective</span>
            <input type="date" className={input} value={effective} max={d.today} onChange={(e) => setEffective(e.target.value || d.today)} />
          </label>
          <button type="button" disabled={!account || same} onClick={() => setStep(2)} className={btn("primary", "lg", "w-full")}>
            Next
          </button>
        </div>
      )}
      {step === 2 && total === 3 && account && (
        <div className="pb-2">
          <p className="px-4 pt-3 text-sm text-muted">On-site staff usually stay with the building. Regional and corporate people stay with {oldName}. Tap anyone to switch.</p>
          <PeopleSorter people={candidates} sides={sides} onFlip={(id) => setSides((s) => ({ ...s, [id]: s[id] === "building" ? "old" : "building" }))} newName={account.label} oldName={oldName ?? "their company"} />
          <div className="grid grid-cols-[auto_1fr] gap-2 px-4 pt-4">
            <button type="button" onClick={() => setStep(1)} className={btn("secondary", "lg")}>
              Back
            </button>
            <button type="button" onClick={() => setStep(3)} className={btn("primary", "lg")}>
              Next
            </button>
          </div>
        </div>
      )}
      {step === confirmStep && step > 1 && account && (
        <div className="flex flex-col gap-4 px-4 pb-2 pt-3">
          <div className="rounded-lg border-l-4 border-accent bg-surface-2 px-4 py-3" aria-live="polite">
            <div className={labelText}>What happens</div>
            <p className="mt-1 font-display text-xl font-bold leading-snug">{summary[0]}</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-base">
              {summary.slice(1).map((l) => (
                <li key={l}>{l}</li>
              ))}
              <li>
                An intro task for {account.label} tops the queue next business day.
              </li>
            </ul>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Note (optional)</span>
            <textarea className={cn(input, "py-2")} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Heard from Luis on site — RPM took over Oct 1." />
          </label>
          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" onClick={() => setStep(step - 1)} className={btn("secondary", "lg")} disabled={pending}>
              Back
            </button>
            <button type="button" onClick={submit} className={btn("primary", "lg")} disabled={pending}>
              {pending ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
