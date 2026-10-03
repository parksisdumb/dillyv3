"use client";
import { useEffect, useState } from "react";
import { searchLogTargets } from "@/lib/actions/log";
import type { ContactOption, SearchHit } from "@/lib/actions/log-types";
import { PERSONA_ROLES, type PersonaRole } from "@/lib/domain/vocab";
import { QuickContactForm } from "@/components/log/quick-contact-form";
import { btn, input } from "@/components/ui/styles";
import { IconBuilding, IconPlus, IconSearch, IconUser } from "@/components/icons";

export function ContactPicker({
  accountId,
  contacts,
  allowAccountLevel,
  onPick,
  onCancel,
}: {
  accountId: string | null;
  contacts: ContactOption[];
  allowAccountLevel: boolean;
  onPick: (c: ContactOption | null, accountId?: string | null) => void;
  onCancel?: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let live = true;
    const h = setTimeout(() => {
      setSearching(true);
      searchLogTargets(q)
        .then((r) => live && setHits(r))
        .finally(() => live && setSearching(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q]);

  if (adding) {
    return (
      <div className="rounded-lg border-2 border-line p-3">
        <QuickContactForm accountId={accountId} onDone={(c) => onPick(c)} onCancel={() => setAdding(false)} />
      </div>
    );
  }

  const showSearch = q.trim().length >= 2;
  const local = contacts.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <span className="sr-only">Search people and accounts</span>
        <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className={`${input} pl-10`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={accountId ? "Search this account or everyone" : "Search people or accounts"}
          autoComplete="off"
          autoFocus={!accountId}
        />
      </label>

      <ul className="divide-y divide-line overflow-hidden rounded-lg border-2 border-line">
        {allowAccountLevel && !showSearch && (
          <li>
            <button type="button" onClick={() => onPick(null, accountId)} className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-surface-2">
              <IconBuilding size={20} className="text-muted" />
              <span className="font-semibold">No contact — log on the account</span>
            </button>
          </li>
        )}
        {(showSearch ? [] : local).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c)} className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-surface-2">
              <IconUser size={20} className="text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block truncate text-sm text-muted">
                  {[c.title, PERSONA_ROLES[c.persona_role as PersonaRole]].filter((x) => x && x !== "Unknown").join(" · ") || " "}
                </span>
              </span>
            </button>
          </li>
        ))}
        {showSearch &&
          hits.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              <button
                type="button"
                onClick={() =>
                  h.kind === "account"
                    ? onPick(null, h.id)
                    : onPick({ id: h.id, name: h.name, title: null, persona_role: "unknown", account_id: h.accountId })
                }
                className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-surface-2"
              >
                {h.kind === "account" ? <IconBuilding size={20} className="text-muted" /> : <IconUser size={20} className="text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{h.name}</span>
                  <span className="block truncate text-sm text-muted">{h.kind === "account" ? `Account${h.sub ? ` · ${h.sub}` : ""}` : h.sub ?? " "}</span>
                </span>
              </button>
            </li>
          ))}
        {showSearch && !searching && hits.length === 0 && <li className="px-3 py-4 text-sm text-muted">No match for “{q}”.</li>}
        {showSearch && searching && hits.length === 0 && <li className="label px-3 py-4 text-sm text-muted">Searching…</li>}
        {!showSearch && local.length === 0 && !allowAccountLevel && <li className="px-3 py-4 text-sm text-muted">Type a name to find someone.</li>}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        {onCancel ? (
          <button type="button" onClick={onCancel} className={btn("secondary", "md")}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => setAdding(true)} className={btn("secondary", "md")}>
          <IconPlus size={18} /> New contact
        </button>
      </div>
    </div>
  );
}
