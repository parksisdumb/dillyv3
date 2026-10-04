"use client";
import { useState } from "react";
import { FIELDS, mappedEntities, type FieldKey, type Mapping } from "@/lib/domain/import/fields";
import type { Sheet } from "@/lib/domain/import/parse";
import type { Member } from "@/lib/domain/import/plan";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/vocab";
import { Chip } from "@/components/ui/bits";
import { btn, cn, input } from "@/components/ui/styles";
import { fieldOptions, OptSelect, type ImportOptions } from "@/components/import/shared";

const ENTITY_TONE: Record<string, "accent" | "good" | "warn" | "neutral"> = { account: "accent", contact: "good", property: "warn", meta: "neutral" };
const ENTITY_LABEL: Record<string, string> = { account: "Company", contact: "Contact", property: "Property", meta: "" };

/** Step 2: each sheet column → a Dilly field, with sample values; import options; save the mapping for next time. */
export function MapStep({
  sheet,
  fileName,
  mapping,
  onMapping,
  opts,
  onOpts,
  members,
  savedName,
  onSave,
  error,
  pending,
  onBack,
  onNext,
}: {
  sheet: Sheet;
  fileName: string;
  mapping: Mapping;
  onMapping: (m: Mapping) => void;
  opts: ImportOptions;
  onOpts: (o: ImportOptions) => void;
  members: Member[];
  savedName: string | null;
  onSave: (name: string) => void;
  error: string | null;
  pending: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const [name, setName] = useState(savedName ?? fileName.replace(/\.(csv|tsv|txt)$/i, ""));
  const ents = mappedEntities(mapping);
  const used = new Set(Object.values(mapping));
  const samples = (i: number) =>
    sheet.rows
      .map((r) => r[i] ?? "")
      .filter(Boolean)
      .slice(0, 3);
  const setField = (i: number, f: string) => {
    const next: Mapping = { ...mapping };
    // One column per field: picking a field another column has moves it here.
    for (const [k, v] of Object.entries(next)) if (v === f) delete next[Number(k)];
    if (f) next[i] = f as FieldKey;
    else delete next[i];
    onMapping(next);
  };
  const mappedCount = Object.keys(mapping).length;

  return (
    <div className="pb-28">
      <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{fileName || "Pasted rows"}</span>
        <span className="num text-muted">
          · {sheet.rows.length.toLocaleString()} rows · {sheet.headers.length} columns · {mappedCount} mapped
        </span>
        {savedName && <Chip tone="accent">Saved mapping: {savedName}</Chip>}
      </div>
      <p className="mx-4 mt-1 text-sm text-muted">
        Creates{" "}
        {[ents.account && "companies", ents.contact && "contacts", ents.property && "properties"].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1") || "nothing yet — map a column"}
        .
      </p>

      <div className="mx-4 mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OptSelect
          label="New companies go to"
          value={opts.defaultOwnerId ?? ""}
          onChange={(v) => onOpts({ ...opts, defaultOwnerId: v || null })}
          options={[...members.map((m) => ({ value: m.user_id, label: m.name })), { value: "", label: "Unassigned" }]}
        />
        <OptSelect
          label="Company’s role at the property"
          value={opts.partyRole}
          onChange={(v) => onOpts({ ...opts, partyRole: v as ImportOptions["partyRole"] })}
          options={[
            { value: "manager", label: "Manager" },
            { value: "owner", label: "Owner" },
          ]}
        />
        <OptSelect
          label="Default company type"
          value={opts.defaultType}
          onChange={(v) => onOpts({ ...opts, defaultType: v as AccountType })}
          options={Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }))}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="label text-xs text-muted">Save this mapping</span>
          <div className="flex gap-2">
            <input className={cn(input, "min-w-0 flex-1")} value={name} onChange={(e) => setName(e.target.value)} aria-label="Mapping name" placeholder="e.g. Yardi export" />
            <button type="button" className={btn("secondary", "md", "shrink-0")} disabled={pending || !name.trim()} onClick={() => onSave(name.trim())}>
              Save
            </button>
          </div>
        </div>
      </div>
      <p className="mx-4 mt-2 text-xs text-muted">A “Rep email” column (email or full name) assigns each new company to that rep; rows without one go to the rep above.</p>

      <div className="mt-4 border-y border-line bg-surface">
        <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.6fr)_16rem] gap-4 border-b-2 border-ink px-4 py-2 sm:grid">
          <span className="label text-xs text-muted">Column in your sheet</span>
          <span className="label text-xs text-muted">Sample values</span>
          <span className="label text-xs text-muted">Imports as</span>
        </div>
        <ul className="divide-y divide-line">
          {sheet.headers.map((h, i) => {
            const f = mapping[i];
            const ent = f ? FIELDS[f].entity : null;
            return (
              <li key={i} className={cn("grid gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.6fr)_16rem] sm:items-center sm:gap-4", !f && "bg-surface-2/50")}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold">{h}</span>
                  {ent && ENTITY_LABEL[ent] && <Chip tone={ENTITY_TONE[ent]}>{ENTITY_LABEL[ent]}</Chip>}
                </div>
                <div className="min-w-0 truncate text-sm text-muted">{samples(i).join(" · ") || <em>empty</em>}</div>
                <select
                  className={cn(input, "appearance-auto", !f && "text-muted")}
                  value={f ?? ""}
                  onChange={(e) => setField(i, e.target.value)}
                  aria-label={`Import “${h}” as`}
                >
                  {fieldOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {o.value && used.has(o.value as FieldKey) && o.value !== f ? " (in use)" : ""}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>

      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t border-line bg-ground/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2 px-4 py-3 lg:max-w-[1180px]">
          <button type="button" className={btn("secondary", "md")} onClick={onBack}>
            Start over
          </button>
          <button type="button" className={btn("primary", "md", "flex-1")} onClick={onNext} disabled={pending || mappedCount === 0}>
            {pending ? "Checking for duplicates…" : "Preview import"}
          </button>
        </div>
      </div>
    </div>
  );
}
