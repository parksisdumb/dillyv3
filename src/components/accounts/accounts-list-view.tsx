import Link from "next/link";
import { ACCOUNT_TYPES } from "@/lib/domain/vocab";
import { AccountRow, type AccountRowData } from "@/components/accounts/account-row";
import { Empty, ErrorNote } from "@/components/ui/bits";
import { BookTabs } from "@/components/accounts/book-tabs";
import { btn, cn, input } from "@/components/ui/styles";
import { IconPlus, IconSearch } from "@/components/icons";

const STATES = [
  { v: "", label: "All" },
  { v: "cold", label: "Cold" },
  { v: "not_started", label: "Not started" },
  { v: "active", label: "Active" },
  { v: "excluded", label: "Excluded" },
];

export type SP = { q?: string; scope?: string; state?: string; type?: string; tier?: string };

export function AccountsListView({ sp, scope, q, data, error }: { sp: SP; scope: "mine" | "all"; q: string; data: AccountRowData[] | null; error?: string | null }) {
  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const str = p.toString();
    return `/app/accounts${str ? `?${str}` : ""}`;
  };

  return (
    <div>
      <BookTabs active="accounts" />

      <form method="get" action="/app/accounts" className="mt-3 flex flex-col gap-2 px-4">
        <input type="hidden" name="scope" value={scope} />
        {sp.state && <input type="hidden" name="state" value={sp.state} />}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search accounts</span>
            <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search accounts" className={`${input} pl-10`} type="search" autoComplete="off" />
          </label>
          <Link href="/app/accounts/new" className={btn("secondary", "md", "shrink-0")}>
            <IconPlus size={18} /> Account
          </Link>
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select name="type" defaultValue={sp.type ?? ""} className={input} aria-label="Account type">
            <option value="">Any type</option>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="tier" defaultValue={sp.tier ?? ""} className={input} aria-label="Priority tier">
            <option value="">Any tier</option>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t}>
                P{t}
              </option>
            ))}
          </select>
          <button type="submit" className={btn("primary", "md")}>
            Go
          </button>
        </div>
      </form>

      <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Whose accounts">
        {(["mine", "all"] as const).map((v) => (
          <Link
            key={v}
            href={href({ scope: v })}
            aria-current={scope === v ? "true" : undefined}
            className={cn("label inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm", scope === v ? "border-ink bg-ink text-ground" : "border-line")}
          >
            {v === "mine" ? "My accounts" : "Everyone's"}
          </Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line" />
        {STATES.map((st) => (
          <Link
            key={st.v || "all"}
            href={href({ state: st.v || undefined })}
            aria-current={(sp.state ?? "") === st.v ? "true" : undefined}
            className={cn(
              "label inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm",
              (sp.state ?? "") === st.v ? "border-accent bg-accent text-accent-ink" : "border-line",
            )}
          >
            {st.label}
          </Link>
        ))}
      </div>

      {error && <ErrorNote>Couldn&apos;t load accounts: {error}</ErrorNote>}
      {data && data.length === 0 && (
        <div className="mt-4">
          <Empty title={q ? `Nothing matches “${q}”` : "No accounts here"}>
            {scope === "mine" ? (
              <Link className="underline" href={href({ scope: "all" })}>
                Look in everyone&apos;s accounts
              </Link>
            ) : (
              "Add one with New."
            )}
          </Empty>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-y border-line bg-surface">
          {data.map((a) => (
            <AccountRow key={a.id} a={a} />
          ))}
        </ul>
      )}
      {data && data.length === 150 && <p className="px-4 py-3 text-sm text-muted">Showing the top 150. Search or filter to narrow.</p>}
    </div>
  );
}
