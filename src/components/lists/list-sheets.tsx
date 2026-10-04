"use client";
// Sheets for lists: Add to list (rows, detail), Save as list (Properties filters), Assign to reps (managers).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToList, assignList, createList, type ListResult } from "@/lib/actions/lists";
import type { ListFilter } from "@/lib/lists/filter";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { IconList, IconPlus, IconUser } from "@/components/icons";

export type ListOption = { id: string; name: string; n?: number };

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const run = (work: () => Promise<ListResult>, done?: (r: Extract<ListResult, { ok: true }>) => void) =>
    start(async () => {
      setError(null);
      let r: ListResult;
      try {
        r = await work();
      } catch {
        r = { ok: false, error: "Couldn't save — can't reach the server. Check your signal and try again." };
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.message);
      done?.(r);
      router.refresh();
    });
  return { pending, error, run, setError };
}

/** Pick a static list (or start a new one) and add buildings to it. `getIds` is read when the sheet opens. */
export function AddToListButton({
  lists,
  propertyIds,
  getIds,
  label = "Add to list",
  className,
  variant = "secondary",
  disabled,
}: {
  lists: ListOption[];
  propertyIds?: string[];
  getIds?: () => string[];
  label?: string;
  className?: string;
  variant?: "secondary" | "primary" | "ghost";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const { pending, error, run, setError } = useRun();
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className={btn(variant, "md", className)}
        onClick={() => {
          const picked = getIds ? getIds() : propertyIds ?? [];
          if (!picked.length) return;
          setIds(picked);
          setError(null);
          setOpen(true);
        }}
      >
        <IconList size={18} /> {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Add ${ids.length === 1 ? "this property" : `${ids.length} properties`} to…`} labelledBy="add-to-list">
        <ul className="divide-y divide-line border-b border-line">
          {lists.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => addToList({ listId: l.id, propertyIds: ids }), () => setOpen(false))}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2"
              >
                <IconList size={20} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
                {l.n != null && <span className="num text-sm text-muted">{l.n}</span>}
              </button>
            </li>
          ))}
          {lists.length === 0 && <li className="px-4 py-3 text-sm text-muted">No hand-picked lists yet — start one below.</li>}
        </ul>
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createList({ name, mode: "empty", propertyIds: ids }), () => {
              setOpen(false);
              setName("");
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>New list</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Midtown PMCs to walk" required maxLength={120} />
          </label>
          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={btn("primary", "md", "w-full")}>
            <IconPlus size={18} /> {pending ? "Saving…" : "Create list and add"}
          </button>
        </form>
      </Sheet>
    </>
  );
}

/** Save the current Properties filter as a smart list (keeps updating) or a snapshot (today's matches). */
export function SaveAsListButton({ filter, summary, isManager, count }: { filter: ListFilter; summary: string[]; isManager: boolean; count: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(summary.join(" · ").slice(0, 80));
  const [mode, setMode] = useState<"smart" | "snapshot">("smart");
  const [team, setTeam] = useState(isManager);
  const { pending, error, run } = useRun();
  const router = useRouter();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("secondary", "sm")}>
        <IconPlus size={16} /> Save as list
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Save as list" labelledBy="save-as-list">
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createList({ name, mode, filter: filter as Record<string, string>, visibility: team ? "team" : "private" }),
              (r) => {
                setOpen(false);
                if (r.id) router.push(`/app/lists/${r.id}`);
              },
            );
          }}
        >
          <p className="text-sm text-muted">{summary.length ? summary.join(" · ") : "All properties"}</p>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Name</span>
            <input className={input} name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className={cn(labelText, "pb-1.5")}>Keep it</legend>
            {(
              [
                ["smart", "Updating", "Buildings join and leave as they match (smart list)."],
                ["snapshot", `Fixed · these ${count}`, "Today's matches, saved as a hand-picked list you can edit."],
              ] as const
            ).map(([k, l, sub]) => (
              <label key={k} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border-2 px-3 py-2", mode === k ? "border-ink" : "border-line")}>
                <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="mt-1 size-5 accent-[var(--color-accent)]" />
                <span>
                  <span className="block font-semibold">{l}</span>
                  <span className="block text-sm text-muted">{sub}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {isManager && (
            <label className="flex min-h-12 items-center gap-3">
              <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} className="size-5" />
              <span>Share with the team</span>
            </label>
          )}
          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={btn("primary", "lg", "w-full")}>
            {pending ? "Saving…" : "Save list"}
          </button>
        </form>
      </Sheet>
    </>
  );
}

export type RepOption = { user_id: string; name: string; role: string };

/** Managers: hand a list to reps (multi-select). Assigned lists show on the rep's Lists tab and feed their Go. */
export function AssignListButton({ listId, members, assigned }: { listId: string; members: RepOption[]; assigned: string[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(assigned));
  const { pending, error, run } = useRun();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("secondary", "md", "flex-1")}>
        <IconUser size={18} /> {assigned.length ? `Assigned · ${assigned.length}` : "Assign to reps"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Assign to reps" labelledBy="assign-list">
        <ul className="divide-y divide-line border-b border-line">
          {members.map((m) => (
            <li key={m.user_id}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={picked.has(m.user_id)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) n.add(m.user_id);
                    else n.delete(m.user_id);
                    setPicked(n);
                  }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{m.name}</span>
                <span className="label text-xs text-muted">{m.role}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted">It shows on their Lists tab, and its untouched buildings feed their Go list.</p>
          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            className={btn("primary", "lg", "w-full")}
            onClick={() => run(() => assignList({ listId, userIds: [...picked] }), () => setOpen(false))}
          >
            {pending ? "Saving…" : picked.size ? `Assign to ${picked.size}` : "Unassign everyone"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
