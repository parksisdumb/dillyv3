"use client";
// Multi-select action bar for property rows (Properties → Select, and a list page). Rows render plain checkboxes
// (<input type="checkbox" data-bulk="props" value=id>) server-side; this bar reads them when an action runs.
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { removeFromList, setPursuit } from "@/lib/actions/lists";
import { useToast } from "@/components/ui/toast";
import { btn } from "@/components/ui/styles";
import { HideLogFab } from "@/components/log/log-provider";
import { IconTarget, IconX } from "@/components/icons";
import { AddToListButton, type ListOption } from "@/components/lists/list-sheets";

const SEL = 'input[type="checkbox"][data-bulk="props"]';

function boxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(SEL)];
}

export function BulkBar({ lists, listId, doneHref }: { lists: ListOption[]; listId?: string; doneHref: string }) {
  const [n, setN] = useState(0);
  const [total, setTotal] = useState(0);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const count = () => {
      const all = boxes();
      setTotal(all.length);
      setN(all.filter((b) => b.checked).length);
    };
    count();
    document.addEventListener("change", count);
    return () => document.removeEventListener("change", count);
  }, []);

  const picked = () => boxes().filter((b) => b.checked).map((b) => b.value);
  const clear = () => {
    for (const b of boxes()) b.checked = false;
    setN(0);
  };
  const act = (work: (ids: string[]) => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    const ids = picked();
    if (!ids.length) return;
    start(async () => {
      let r: { ok: boolean; error?: string; message?: string };
      try {
        r = await work(ids);
      } catch {
        r = { ok: false, error: "Couldn't save — can't reach the server." };
      }
      if (!r.ok) {
        toast(r.error ?? "Couldn't do that.", "bad");
        return;
      }
      toast(r.message ?? "Done");
      clear();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t-2 border-ink bg-surface shadow-2xl" role="toolbar" aria-label="Selected properties">
      <HideLogFab />
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="num flex-1 font-semibold" aria-live="polite">
            {n} selected
          </span>
          <button
            type="button"
            className="min-h-12 px-2 font-semibold underline"
            onClick={() => {
              const all = boxes();
              const on = all.some((b) => !b.checked);
              for (const b of all) b.checked = on;
              setN(on ? all.length : 0);
            }}
          >
            {n < total || total === 0 ? `Select all ${total}` : "Clear"}
          </button>
          <Link href={doneHref} className="inline-flex size-12 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Done selecting">
            <IconX size={20} />
          </Link>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!n || pending} onClick={() => act((ids) => setPursuit({ propertyIds: ids, status: "active" }))} className={btn("primary", "md", "flex-1")}>
            <IconTarget size={18} /> Mark active
          </button>
          {listId ? (
            <button type="button" disabled={!n || pending} onClick={() => act((ids) => removeFromList({ listId, propertyIds: ids }))} className={btn("danger", "md", "flex-1")}>
              Remove
            </button>
          ) : (
            <AddToListButton lists={lists} getIds={picked} disabled={!n || pending} className="flex-1" />
          )}
        </div>
      </div>
    </div>
  );
}

/** The checkbox a selectable row renders in place of its chevron. */
export function BulkCheck({ id, name }: { id: string; name: string }) {
  return (
    <label className="-my-1 -mr-2 inline-flex size-12 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" data-bulk="props" value={id} className="size-6" aria-label={`Select ${name}`} />
    </label>
  );
}
