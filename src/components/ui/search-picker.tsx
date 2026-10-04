"use client";
import { useEffect, useState, useTransition } from "react";
import type { PickOption } from "@/lib/actions/book";
import { cn, input, labelText } from "@/components/ui/styles";
import { IconPlus, IconSearch, IconX } from "@/components/icons";

/**
 * Searchable single-select that writes a hidden input (works inside any form).
 * Optional inline create ("Create account “Acme”") when nothing matches.
 */
export function SearchPicker({
  name,
  label,
  search,
  create,
  initial,
  placeholder = "Search",
  hint,
  onChange,
  required,
}: {
  name: string;
  label: string;
  search: (q: string) => Promise<PickOption[]>;
  create?: (q: string) => Promise<{ ok: true; option: PickOption; existed: boolean } | { ok: false; error: string }>;
  initial?: PickOption | null;
  placeholder?: string;
  hint?: string;
  onChange?: (o: PickOption | null) => void;
  required?: boolean;
}) {
  const [selected, setSelected] = useState<PickOption | null>(initial ?? null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (selected || q.trim().length < 2) return;
    let live = true;
    const h = setTimeout(() => {
      search(q).then((r) => live && setHits(r));
    }, 220);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q, selected, search]);

  const pick = (o: PickOption | null) => {
    setSelected(o);
    setQ("");
    setHits([]);
    setError(null);
    onChange?.(o);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelText}>
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex min-h-12 items-center gap-2 rounded-lg border-2 border-ink bg-surface pl-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{selected.label}</span>
            {selected.sub && <span className="block truncate text-xs text-muted">{selected.sub}</span>}
          </span>
          <button type="button" onClick={() => pick(null)} className="inline-flex size-12 shrink-0 items-center justify-center" aria-label={`Clear ${label.toLowerCase()}`}>
            <IconX size={18} />
          </button>
        </div>
      ) : (
        <div>
          <label className="relative block">
            <span className="sr-only">{label}</span>
            <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className={cn(input, "pl-10")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoComplete="off" />
          </label>
          {q.trim().length >= 2 && (
            <ul className="mt-1 divide-y divide-line overflow-hidden rounded-lg border-2 border-line bg-surface">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => pick(h)} className="flex min-h-12 w-full flex-col justify-center px-3 py-1 text-left hover:bg-surface-2">
                    <span className="font-semibold">{h.label}</span>
                    {h.sub && <span className="text-xs text-muted">{h.sub}</span>}
                  </button>
                </li>
              ))}
              {create && (
                <li>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await create(q);
                        if (r.ok) pick(r.option);
                        else setError(r.error);
                      })
                    }
                    className="flex min-h-12 w-full items-center gap-2 px-3 text-left font-semibold text-accent hover:bg-surface-2"
                  >
                    <IconPlus size={18} /> {pending ? "Creating…" : `Create “${q.trim()}”`}
                  </button>
                </li>
              )}
              {!create && hits.length === 0 && <li className="px-3 py-3 text-sm text-muted">No match.</li>}
            </ul>
          )}
        </div>
      )}
      {hint && !selected && <span className="text-xs text-muted">{hint}</span>}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
