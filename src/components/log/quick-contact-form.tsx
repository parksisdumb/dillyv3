"use client";
import { useState, useTransition } from "react";
import { quickCreateContact, getContactOption } from "@/lib/actions/log";
import type { ContactOption, SimilarContact } from "@/lib/actions/log-types";
import { PERSONA_ROLES } from "@/lib/domain/vocab";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { SearchPicker } from "@/components/ui/search-picker";
import { quickCreateAccount, searchAccountOptions, type PickOption } from "@/lib/actions/book";

/**
 * "Add person I met" — name, title, role, phone, email. Checks for duplicates before creating
 * and asks "Is this them?" when something close already exists.
 */
export function QuickContactForm({
  accountId,
  propertyId,
  source = "rep",
  onDone,
  onCancel,
  submitLabel = "Add contact",
  pickAccount = false,
}: {
  /** Show a searchable account picker (with inline create) when the contact isn't created inside an account. */
  pickAccount?: boolean;
  accountId?: string | null;
  propertyId?: string | null;
  source?: "rep" | "field";
  onDone: (c: ContactOption, created: boolean) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [f, setF] = useState({ fullName: "", title: "", personaRole: "unknown", phone: "", email: "" });
  const [dupes, setDupes] = useState<SimilarContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pickedAccount, setPickedAccount] = useState<PickOption | null>(null);

  const submit = (force: boolean) =>
    start(async () => {
      setError(null);
      const r = await quickCreateContact({ ...f, accountId: accountId ?? pickedAccount?.id ?? null, propertyId, source, force });
      if (r.ok) {
        setDupes(null);
        onDone(r.contact, true);
      } else if (r.duplicates) setDupes(r.duplicates);
      else setError(r.error);
    });

  const pickExisting = (id: string) =>
    start(async () => {
      const c = await getContactOption(id);
      if (c) onDone(c, false);
      else setError("Couldn't load that contact.");
    });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  if (dupes) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-display text-xl font-bold">Is this them?</p>
        <ul className="divide-y divide-line rounded-lg border-2 border-line">
          {dupes.map((d) => (
            <li key={d.id}>
              <button type="button" disabled={pending} onClick={() => pickExisting(d.id)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{d.full_name ?? "Unnamed"}</div>
                  <div className="truncate text-sm text-muted">{[d.account_name, d.phone, d.email].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="label text-xs text-accent">Use</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" disabled={pending} onClick={() => submit(true)} className={btn("secondary", "md", "w-full")}>
          No — add {f.fullName || "new person"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Name</span>
        <input className={input} value={f.fullName} onChange={set("fullName")} required autoComplete="off" placeholder="Dave Morales" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Title</span>
          <input className={input} value={f.title} onChange={set("title")} placeholder="Chief engineer" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Role</span>
          <select className={input} value={f.personaRole} onChange={set("personaRole")}>
            {Object.entries(PERSONA_ROLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Phone</span>
          <input className={input} value={f.phone} onChange={set("phone")} type="tel" inputMode="tel" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Email</span>
          <input className={input} value={f.email} onChange={set("email")} type="email" inputMode="email" />
        </label>
      </div>
      {pickAccount && !accountId && (
        <SearchPicker
          name="account_id"
          label="Account"
          search={searchAccountOptions}
          create={quickCreateAccount}
          initial={pickedAccount}
          onChange={setPickedAccount}
          placeholder="Company they work for"
          hint="Optional, but contacts on an account rank, route and close follow-ups properly."
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className={cn("grid gap-2", onCancel ? "grid-cols-2" : "grid-cols-1")}>
        {onCancel && (
          <button type="button" onClick={onCancel} className={btn("secondary", "md")}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={pending} className={btn("primary", "md")}>
          {pending ? "Checking…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
