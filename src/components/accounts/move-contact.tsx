"use client";
// Contact detail: "Changed companies" — follow the person to their new company. Touches stay with them.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickCreateAccount, searchAccountOptions, type PickOption } from "@/lib/actions/book";
import { moveContact } from "@/lib/actions/ownership";
import { plural } from "@/lib/format";
import { SearchPicker } from "@/components/ui/search-picker";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconSwap } from "@/components/icons";

export type MoveContactPreview = { step: 1 | 2; account: PickOption; title?: string };

export function MoveContact({
  contactId,
  name,
  firstName,
  title,
  oldCompany,
  today,
  touches,
  buildings,
  preview,
}: {
  contactId: string;
  name: string;
  firstName: string;
  title: string | null;
  oldCompany: string | null;
  today: string;
  touches: number;
  buildings: number; // linked buildings run by the old company (they'll be unlinked)
  preview?: MoveContactPreview;
}) {
  const [open, setOpen] = useState(!!preview);
  const [step, setStep] = useState<1 | 2>(preview?.step ?? 1);
  const [account, setAccount] = useState<PickOption | null>(preview?.account ?? null);
  const [newTitle, setNewTitle] = useState(preview?.title ?? "");
  const [effective, setEffective] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const close = () => {
    setOpen(false);
    setStep(1);
    setError(null);
  };
  const submit = () =>
    start(async () => {
      if (!account) return;
      const r = await moveContact({ contactId, newAccountId: account.id, newTitle: newTitle || undefined, effective });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(`${name} is now at ${account.label}. Reconnect task is in your queue.`);
      close();
      router.refresh();
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("secondary", "md", "w-full")}>
        <IconSwap size={18} /> Changed companies
      </button>
      <Sheet open={open} onClose={close} title={`${firstName} changed companies`} labelledBy="move-contact-title">
        {step === 1 ? (
          <div className="flex flex-col gap-4 px-4 pb-2 pt-3">
            <SearchPicker
              name="new_account"
              label="New company"
              search={searchAccountOptions}
              create={quickCreateAccount}
              initial={account}
              onChange={setAccount}
              placeholder="Where they work now"
              hint="Not in Dilly yet? Type the name and tap Create."
              required
            />
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>New title</span>
              <input className={input} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={title ?? "Regional Manager"} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Since</span>
              <input type="date" className={input} value={effective} max={today} onChange={(e) => setEffective(e.target.value || today)} />
            </label>
            <button type="button" disabled={!account} onClick={() => setStep(2)} className={btn("primary", "lg", "w-full")}>
              Next
            </button>
          </div>
        ) : (
          account && (
            <div className="flex flex-col gap-4 px-4 pb-2 pt-3">
              <div className="rounded-lg border-l-4 border-accent bg-surface-2 px-4 py-3">
                <div className={labelText}>What happens</div>
                <p className="mt-1 font-display text-xl font-bold leading-snug">
                  {name} moves{oldCompany ? ` from ${oldCompany}` : ""} to {account.label}
                  {newTitle ? ` as ${newTitle}` : ""}.
                </p>
                <ul className="mt-2 flex flex-col gap-1.5 text-base">
                  <li>{touches > 0 ? `All ${plural(touches, "touch", "touches")} stay with ${firstName}.` : `${firstName}'s history comes along.`}</li>
                  {buildings > 0 && oldCompany && <li>Unlinked from {plural(buildings, "building")} {oldCompany} still runs.</li>}
                  {oldCompany && <li>Work history keeps {oldCompany}.</li>}
                  <li>
                    “Reconnect with {name} at {account.label}” tops the queue next business day — a warm lead.
                  </li>
                </ul>
              </div>
              {error && (
                <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <div className={cn("grid grid-cols-[auto_1fr] gap-2")}>
                <button type="button" onClick={() => setStep(1)} className={btn("secondary", "lg")} disabled={pending}>
                  Back
                </button>
                <button type="button" onClick={submit} className={btn("primary", "lg")} disabled={pending}>
                  {pending ? "Saving…" : "Confirm"}
                </button>
              </div>
            </div>
          )
        )}
      </Sheet>
    </>
  );
}
