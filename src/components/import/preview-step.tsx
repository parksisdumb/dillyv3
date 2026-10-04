"use client";
import { useState } from "react";
import type { Action, Match, Member, Plan, PlanCounts } from "@/lib/domain/import/plan";
import { liveEntities, ownerTally } from "@/lib/domain/import/plan";
import { Chip } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { OptSelect, type ImportOptions } from "@/components/import/shared";

export type Overrides = {
  accounts: Record<string, Action>;
  contacts: Record<string, Action>;
  properties: Record<string, Action>;
  /** Row index → include (true) / skip (false), overriding the default. */
  include: Record<number, boolean>;
};

type Kind = "accounts" | "contacts" | "properties";
type Tab = Kind | "issues";

const LABEL: Record<Kind, string> = { accounts: "Companies", contacts: "Contacts", properties: "Properties" };
const LIMIT = 100;
const sheetRow = (i: number) => i + 2; // header is row 1

type Item = { key: string; title: string; sub: string; match: Match | null; action: Action; rows: number[]; extra?: string };

/** Step 3: what will happen, before anything is written. */
export function PreviewStep({
  plan,
  counts,
  members,
  opts,
  onOpts,
  overrides,
  onOverrides,
  initialTab,
  onBack,
  onConfirm,
}: {
  plan: Plan;
  counts: PlanCounts;
  members: Member[];
  opts: ImportOptions;
  onOpts: (o: ImportOptions) => void;
  overrides: Overrides;
  onOverrides: (o: Overrides) => void;
  initialTab?: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const live = liveEntities(plan);
  const kinds = (["accounts", "contacts", "properties"] as Kind[]).filter((k) => plan[k].length > 0);
  const issues = plan.rows.filter((r) => !r.empty && (r.errors.length || r.warnings.length || r.dupeOf != null));
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? kinds[0] ?? "issues");
  const [all, setAll] = useState(false);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const owners = [...ownerTally(plan).entries()].sort((a, b) => b[1] - a[1]);
  const writes = counts.accounts.create + counts.contacts.create + counts.properties.create + counts.accounts.link + counts.contacts.link + counts.properties.link;

  const items: Record<Kind, Item[]> = {
    accounts: live.accounts.map((a) => ({
      key: a.key,
      title: a.draft.name,
      sub: a.action === "create" ? `Owner: ${a.ownerId ? names.get(a.ownerId) ?? "—" : "Unassigned"}` : "",
      match: a.match,
      action: a.action,
      rows: a.rows,
    })),
    contacts: live.contacts.map((c) => ({
      key: c.key,
      title: c.draft.full || c.draft.email || "Unnamed",
      sub: [c.draft.title, c.draft.email, c.draft.phone ?? c.draft.mobile].filter(Boolean).join(" · "),
      match: c.match,
      action: c.action,
      rows: c.rows,
    })),
    properties: live.properties.map((p) => ({
      key: p.key,
      title: p.draft.name || p.draft.address1 || "Property",
      sub: [p.draft.name ? p.draft.address1 : null, p.draft.city, p.draft.roof_system, p.draft.roof_install_year, p.draft.roof_area_sf ? `${p.draft.roof_area_sf.toLocaleString()} sf` : null].filter(Boolean).join(" · "),
      match: p.match,
      action: p.action,
      rows: p.rows,
    })),
  };

  const setOne = (k: Kind, key: string, a: Action) => onOverrides({ ...overrides, [k]: { ...overrides[k], [key]: a } });
  const setBulk = (k: Kind, which: "matched" | "new", a: Action) => {
    const next = { ...overrides[k] };
    for (const it of items[k]) if (!!it.match === (which === "matched") && (a !== "link" || it.match)) next[it.key] = a;
    onOverrides({ ...overrides, [k]: next });
  };

  return (
    <div className="pb-28">
      <div className="mx-4 mt-2 grid grid-cols-3 gap-2">
        {(["accounts", "contacts", "properties"] as Kind[]).map((k) => {
          const c = counts[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn("rounded-lg border-2 bg-surface p-3 text-left", tab === k ? "border-ink" : "border-line hover:border-ink")}
              aria-pressed={tab === k}
            >
              <span className="label block text-xs text-muted">{LABEL[k]}</span>
              <span className="num block font-display text-3xl font-extrabold leading-tight">{c.create}</span>
              <span className="num block text-xs text-muted">
                new · {c.matched} matched{c.skip ? ` · ${c.skip} skip` : ""}
              </span>
            </button>
          );
        })}
      </div>

      <p className="num mx-4 mt-3 text-sm">
        <strong>{counts.rows.total.toLocaleString()}</strong> rows ·{" "}
        <span className={cn(counts.rows.errors > 0 && "font-semibold text-danger")}>{counts.rows.errors} with errors</span>
        {counts.rows.skipped > 0 && <> ({counts.rows.skipped} skipped)</>} · {counts.rows.repeats} repeats · {counts.rows.warnings} warnings
      </p>

      <div className="mx-4 mt-3 grid items-end gap-3 rounded-lg border-2 border-line bg-surface p-3 sm:grid-cols-[1fr_16rem]">
        <div className="min-w-0 text-sm">
          <span className="label block text-xs text-muted">New companies go to</span>
          <span className="mt-1 flex flex-wrap gap-1.5" data-testid="owner-tally">
            {owners.length === 0 && <span className="text-muted">No new companies</span>}
            {owners.map(([u, n]) => (
              <Chip key={u ?? "none"} tone={u ? "ink" : "neutral"}>
                {u ? names.get(u) ?? "—" : "Unassigned"} · {n}
              </Chip>
            ))}
          </span>
        </div>
        <OptSelect
          label="Rows without a rep go to"
          value={opts.defaultOwnerId ?? ""}
          onChange={(v) => onOpts({ ...opts, defaultOwnerId: v || null })}
          options={[...members.map((m) => ({ value: m.user_id, label: m.name })), { value: "", label: "Unassigned" }]}
        />
      </div>

      <div className="mx-4 mt-4 flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Preview">
        {[...kinds, "issues" as const].map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => {
              setTab(k);
              setAll(false);
            }}
            className={cn(
              "label flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center whitespace-nowrap rounded-md px-1 text-xs sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm",
              tab === k ? "bg-ink text-ground" : "hover:bg-surface",
            )}
          >
            {k === "issues" ? "Issues" : LABEL[k]}
            <span className="num opacity-70">{k === "issues" ? issues.length : items[k].length}</span>
          </button>
        ))}
      </div>

      {tab !== "issues" && (
        <div role="tabpanel" aria-label={LABEL[tab]}>
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <BulkSelect label={`All ${items[tab].filter((i) => i.match).length} matched`} onPick={(a) => setBulk(tab, "matched", a)} options={["link", "create", "skip"]} />
            <BulkSelect label={`All ${items[tab].filter((i) => !i.match).length} new`} onPick={(a) => setBulk(tab, "new", a)} options={["create", "skip"]} />
          </div>
          <ul className="mt-2 divide-y divide-line border-y border-line bg-surface">
            {(all ? items[tab] : items[tab].slice(0, LIMIT)).map((it) => (
              <li key={it.key} className={cn("grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center", it.action === "skip" && "opacity-60")}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{it.title}</span>
                    {it.match ? <Chip tone="accent">Matches existing</Chip> : <Chip tone="good">New</Chip>}
                    {it.rows.length > 1 && <Chip>{it.rows.length} rows</Chip>}
                  </div>
                  {it.sub && <div className="mt-0.5 truncate text-sm text-muted">{it.sub}</div>}
                  {it.match && (
                    <div className="mt-0.5 text-sm">
                      <span className="text-muted">Existing: </span>
                      <span className="font-semibold">{it.match.label}</span>
                      <span className="text-muted"> — {it.match.why}</span>
                    </div>
                  )}
                  <div className="num mt-0.5 text-xs text-muted">Row {it.rows.slice(0, 6).map(sheetRow).join(", ")}{it.rows.length > 6 ? "…" : ""}</div>
                </div>
                <ActionPicker value={it.action} matched={!!it.match} onChange={(a) => setOne(tab, it.key, a)} label={it.title} />
              </li>
            ))}
          </ul>
          {!all && items[tab].length > LIMIT && (
            <button type="button" className={btn("ghost", "sm", "mx-4 mt-2")} onClick={() => setAll(true)}>
              Show all {items[tab].length.toLocaleString()}
            </button>
          )}
        </div>
      )}

      {tab === "issues" && (
        <div role="tabpanel" aria-label="Issues">
          {issues.length === 0 && <p className="mx-4 mt-3 text-sm text-muted">No problems found.</p>}
          <ul className="mt-3 divide-y divide-line border-y border-line bg-surface">
            {(all ? issues : issues.slice(0, LIMIT)).map((r) => {
              const hasEntity = !!(r.accountKey || r.contactKey || r.propertyKey);
              return (
                <li key={r.index} className="flex items-start gap-3 px-4 py-3">
                  <span className="num label w-16 shrink-0 pt-0.5 text-xs text-muted">Row {sheetRow(r.index)}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    {r.errors.map((e, i) => (
                      <p key={`e${i}`} className="font-semibold text-danger">
                        {e.message}
                      </p>
                    ))}
                    {r.warnings.map((w, i) => (
                      <p key={`w${i}`} className="text-warning">
                        {w.message}
                      </p>
                    ))}
                    {r.dupeOf != null && <p className="text-muted">Repeats row {sheetRow(r.dupeOf)} — merged into the same records.</p>}
                  </div>
                  {r.errors.length > 0 && hasEntity && (
                    <label className="flex shrink-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--accent)]"
                        checked={!r.skip}
                        onChange={(e) => onOverrides({ ...overrides, include: { ...overrides.include, [r.index]: e.target.checked } })}
                      />
                      Import anyway
                    </label>
                  )}
                  {r.errors.length > 0 && !hasEntity && <Chip tone="bad">Skipped</Chip>}
                </li>
              );
            })}
          </ul>
          {issues.some((r) => r.errors.length > 0) && <p className="mx-4 mt-2 text-xs text-muted">Rows with errors are skipped. “Import anyway” keeps the row and drops the bad value.</p>}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t border-line bg-ground/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 lg:max-w-[1180px]">
          <button type="button" className={btn("secondary", "md")} onClick={onBack}>
            Back
          </button>
          <span className="hidden flex-1 text-sm text-muted sm:block">Nothing is saved until you import.</span>
          <button type="button" className={btn("primary", "md", "flex-1 sm:flex-none")} onClick={onConfirm} disabled={writes === 0}>
            Import {counts.rows.included.toLocaleString()} {counts.rows.included === 1 ? "row" : "rows"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<Action, string> = { create: "Create new", link: "Link to existing", skip: "Skip" };

function ActionPicker({ value, matched, onChange, label }: { value: Action; matched: boolean; onChange: (a: Action) => void; label: string }) {
  const opts: Action[] = matched ? ["link", "create", "skip"] : ["create", "skip"];
  return (
    <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label={`What to do with ${label}`}>
      {opts.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          onClick={() => onChange(a)}
          className={cn("min-h-10 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold sm:flex-none", value === a ? (a === "skip" ? "bg-ink text-ground" : "bg-accent text-accent-ink") : "text-muted hover:bg-surface")}
        >
          {a === "link" ? "Link" : a === "create" ? "Create" : "Skip"}
        </button>
      ))}
    </div>
  );
}

function BulkSelect({ label, options, onPick }: { label: string; options: Action[]; onPick: (a: Action) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted">{label}:</span>
      <select
        className="min-h-10 rounded-lg border-2 border-line bg-surface px-2 text-sm font-semibold"
        value=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value as Action);
        }}
        aria-label={`Set ${label.toLowerCase()} to`}
      >
        <option value="">Set to…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {ACTION_LABEL[o]}
          </option>
        ))}
      </select>
    </label>
  );
}
