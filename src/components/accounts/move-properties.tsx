"use client";
// Account detail: move several of this company's buildings to a new manager/owner in one go (portfolio sale,
// PMC swap). Same confirm pattern as a single transfer; one transaction on the server.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickCreateAccount, searchAccountOptions, type PickOption } from "@/lib/actions/book";
import { transferProperties } from "@/lib/actions/ownership";
import { PARTY_ROLES, portfolioSummary, type PartyRole } from "@/lib/domain/ownership";
import { SearchPicker } from "@/components/ui/search-picker";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconCheck, IconSwap } from "@/components/icons";
import { PeopleSorter, defaultSides, type SheetPerson } from "@/components/accounts/ownership";

export type MovePerson = SheetPerson & { propertyIds: string[] };
export type MovePreview = { step: 1 | 2 | 3 | 4; selected: string[]; role?: PartyRole; account?: PickOption };

export function MoveProperties({
  accountId,
  accountName,
  today,
  properties,
  people,
  preview,
}: {
  accountId: string;
  accountName: string;
  today: string;
  properties: { id: string; name: string; sub: string | null }[];
  people: MovePerson[];
  preview?: MovePreview;
}) {
  const [open, setOpen] = useState(!!preview);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("ghost", "sm")} disabled={properties.length === 0}>
        <IconSwap size={16} /> Move
      </button>
      {open && <MoveSheet {...{ accountId, accountName, today, properties, people, preview }} onClose={() => setOpen(false)} />}
    </>
  );
}

function MoveSheet({
  accountId,
  accountName,
  today,
  properties,
  people,
  preview,
  onClose,
}: {
  accountId: string;
  accountName: string;
  today: string;
  properties: { id: string; name: string; sub: string | null }[];
  people: MovePerson[];
  preview?: MovePreview;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(preview?.step ?? 1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preview?.selected ?? []));
  const [role, setRole] = useState<PartyRole>(preview?.role ?? "manager");
  const [account, setAccount] = useState<PickOption | null>(preview?.account ?? null);
  const [effective, setEffective] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // People at the selected buildings who work for this company.
  const candidates = useMemo(
    () => people.filter((p) => p.account_id === accountId && p.propertyIds.some((id) => selected.has(id))),
    [people, accountId, selected],
  );
  const [sides, setSides] = useState(() => defaultSides(people));
  const hasPeople = candidates.length > 0;
  const total = hasPeople ? 4 : 3;
  const confirmStep = total;
  const withBuilding = candidates.filter((p) => sides[p.id] === "building").map((p) => p.id);
  const withOld = candidates.filter((p) => sides[p.id] === "old").map((p) => p.id);
  const same = account?.id === accountId;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = () =>
    start(async () => {
      if (!account) return;
      setError(null);
      const r = await transferProperties({ propertyIds: [...selected], role, newAccountId: account.id, effective, withBuilding, withOldCompany: withOld });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.message);
      onClose();
      router.refresh();
    });

  const nav = (back: number | null, next: () => void, nextLabel: string, disabled = false) => (
    <div className={cn("grid gap-2 px-4 pt-4", back ? "grid-cols-[auto_1fr]" : "grid-cols-1")}>
      {back && (
        <button type="button" onClick={() => setStep(back as 1 | 2 | 3 | 4)} className={btn("secondary", "lg")} disabled={pending}>
          Back
        </button>
      )}
      <button type="button" onClick={next} className={btn("primary", "lg")} disabled={disabled || pending}>
        {nextLabel}
      </button>
    </div>
  );

  return (
    <Sheet open onClose={onClose} title={`Move ${accountName} properties`} labelledBy="move-props-title">
      <div className="label flex items-center gap-2 px-4 pt-3 text-xs text-muted">
        Step {step} of {total}
        <span className="flex gap-1" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cn("h-1.5 w-6 rounded-full", i < step ? "bg-accent" : "bg-line")} />
          ))}
        </span>
      </div>

      {step === 1 && (
        <div className="pb-2">
          <div className="flex items-center justify-between px-4 pt-2">
            <span className="text-sm text-muted">Which buildings changed hands?</span>
            <button
              type="button"
              className="label inline-flex min-h-12 items-center px-2 text-xs text-accent"
              onClick={() => setSelected(selected.size === properties.length ? new Set() : new Set(properties.map((p) => p.id)))}
            >
              {selected.size === properties.length ? "Clear" : "Select all"}
            </button>
          </div>
          <ul className="mx-4 divide-y divide-line overflow-hidden rounded-lg border-2 border-line">
            {properties.map((p) => {
              const on = selected.has(p.id);
              return (
                <li key={p.id}>
                  <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p.id)} className={cn("flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left", on ? "bg-accent/8" : "bg-surface hover:bg-surface-2")}>
                    <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded border-2", on ? "border-accent bg-accent text-accent-ink" : "border-line")}>
                      {on && <IconCheck size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-sm text-muted">{p.sub ?? " "}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {nav(null, () => setStep(2), selected.size ? `Next · ${selected.size} selected` : "Pick properties", selected.size === 0)}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 px-4 pb-2 pt-3">
          <div role="radiogroup" aria-label="What changed" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
            {(["manager", "owner"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)} className={cn("min-h-12 rounded-md text-sm font-semibold", role === r ? "bg-ink text-ground" : "text-ink")}>
                New {PARTY_ROLES[r].noun === "management" ? "manager" : "owner"}
              </button>
            ))}
          </div>
          <SearchPicker
            name="new_account"
            label={role === "manager" ? "New management company" : "New owner"}
            search={searchAccountOptions}
            create={quickCreateAccount}
            initial={account}
            onChange={setAccount}
            placeholder="Company name"
            hint="Not in Dilly yet? Type the name and tap Create."
            required
          />
          {same && <p className="text-sm text-danger">Pick a different company than {accountName}.</p>}
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Effective</span>
            <input type="date" className={input} value={effective} max={today} onChange={(e) => setEffective(e.target.value || today)} />
          </label>
          <div className="-mx-4">{nav(1, () => setStep(3), "Next", !account || same)}</div>
        </div>
      )}

      {step === 3 && hasPeople && account && (
        <div className="pb-2">
          <p className="px-4 pt-3 text-sm text-muted">On-site staff usually stay with the buildings. Tap anyone to switch.</p>
          <PeopleSorter people={candidates} sides={sides} onFlip={(id) => setSides((s) => ({ ...s, [id]: s[id] === "building" ? "old" : "building" }))} newName={account.label} oldName={accountName} />
          {nav(2, () => setStep(4), "Next")}
        </div>
      )}

      {step === confirmStep && step > 2 && account && (
        <div className="pb-2">
          <div className="mx-4 mt-3 rounded-lg border-l-4 border-accent bg-surface-2 px-4 py-3">
            <div className={labelText}>What happens</div>
            {portfolioSummary({ count: selected.size, role, newName: account.label, oldName: accountName, withBuilding: withBuilding.length, withOldCompany: withOld.length }).map((l, i) =>
              i === 0 ? (
                <p key={l} className="mt-1 font-display text-xl font-bold leading-snug">
                  {l}
                </p>
              ) : (
                <p key={l} className="mt-1.5 text-base">
                  {l}
                </p>
              ),
            )}
            <p className="mt-1.5 text-base">One intro task for {account.label} tops the queue next business day.</p>
          </div>
          <ul className="mx-4 mt-3 flex flex-wrap gap-1.5" aria-label="Properties moving">
            {properties
              .filter((p) => selected.has(p.id))
              .map((p) => (
                <li key={p.id} className="label rounded bg-surface-2 px-2 py-1 text-xs">
                  {p.name}
                </li>
              ))}
          </ul>
          {error && (
            <p role="alert" className="mx-4 mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {nav(hasPeople ? 3 : 2, submit, pending ? "Saving…" : `Confirm · move ${selected.size}`)}
        </div>
      )}
    </Sheet>
  );
}
