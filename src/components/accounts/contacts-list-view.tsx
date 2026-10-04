import Link from "next/link";
import { PERSONA_ROLES, type PersonaRole } from "@/lib/domain/vocab";
import { quietLabel } from "@/lib/format";
import type { ContactListRow, ContactSP } from "@/lib/server/book";
import { BookTabs } from "@/components/accounts/book-tabs";
import { FilterChip, hrefWith } from "@/components/accounts/filter-chip";
import { Chip, Empty, ErrorNote } from "@/components/ui/bits";
import { btn, cn, input } from "@/components/ui/styles";
import { LogButton } from "@/components/log/log-button";
import { IconChevronRight, IconMail, IconPhone, IconPlus, IconSearch } from "@/components/icons";

const SHOW = [
  { v: "", label: "All" },
  { v: "never", label: "Never touched" },
  { v: "quiet", label: "Going quiet" },
  { v: "phone", label: "Has phone" },
  { v: "email", label: "Has email" },
  { v: "bounced", label: "Bounced" },
];
const iconBtn = "inline-flex size-12 shrink-0 items-center justify-center rounded-lg border-2 border-line bg-surface hover:border-ink";

export function ContactsListView({
  sp,
  rows,
  error,
  capped,
  headerExtra,
}: {
  sp: ContactSP;
  rows: ContactListRow[];
  error?: string | null;
  capped?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const scope = sp.scope === "all" ? "all" : "mine";
  const base = "/app/contacts";
  return (
    <div>
      <BookTabs active="contacts" />
      {headerExtra}
      <form method="get" action={base} className="mt-3 flex flex-col gap-2 px-4">
        {Object.entries(sp).map(([k, v]) => (k !== "q" && k !== "role" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search contacts</span>
            <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search contacts" className={`${input} pl-10`} type="search" autoComplete="off" />
          </label>
          <Link href="/app/contacts/new" className={btn("secondary", "md", "shrink-0")}>
            <IconPlus size={18} /> Contact
          </Link>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select name="role" defaultValue={sp.role ?? ""} className={input} aria-label="Persona role">
            <option value="">Any role</option>
            {Object.entries(PERSONA_ROLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button type="submit" className={btn("primary", "md", "px-6")}>
            Go
          </button>
        </div>
      </form>

      <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filters">
        <FilterChip href={hrefWith(base, sp, { scope: undefined })} active={scope === "mine"}>
          Mine
        </FilterChip>
        <FilterChip href={hrefWith(base, sp, { scope: "all" })} active={scope === "all"}>
          Everyone&apos;s
        </FilterChip>
        <span className="mx-1 w-px shrink-0 bg-line" />
        {SHOW.map((f) => (
          <FilterChip key={f.v || "all"} tone="accent" href={hrefWith(base, sp, { show: f.v || undefined })} active={(sp.show ?? "") === f.v}>
            {f.label}
          </FilterChip>
        ))}
      </div>
      <div className="flex items-center justify-between px-4 pt-1 text-sm text-muted">
        <span className="num">
          {rows.length}
          {capped ? "+" : ""} contacts
        </span>
        <span>
          Sort:{" "}
          <Link className={cn("inline-flex min-h-12 items-center px-1", sp.sort !== "name" && "font-semibold text-ink")} href={hrefWith(base, sp, { sort: undefined })}>
            Recent
          </Link>
          ·
          <Link className={cn("inline-flex min-h-12 items-center px-1", sp.sort === "name" && "font-semibold text-ink")} href={hrefWith(base, sp, { sort: "name" })}>
            Name
          </Link>
        </span>
      </div>

      {error && <ErrorNote>Couldn&apos;t load contacts: {error}</ErrorNote>}
      {!error && rows.length === 0 && (
        <Empty title={sp.q ? `Nobody matches “${sp.q}”` : "No contacts here"}>
          {scope === "mine" ? (
            <Link className="underline" href={hrefWith(base, sp, { scope: "all" })}>
              Look in everyone&apos;s contacts
            </Link>
          ) : (
            "Add the people you meet with + Contact."
          )}
        </Empty>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="px-4 pb-2 pt-3">
              <Link href={`/app/contacts/${r.id}`} className="-mx-2 block rounded-lg px-2 py-1 hover:bg-surface-2">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-display text-base font-bold">{r.name}</span>
                  {r.dupe && <Chip tone="warn" className="shrink-0 whitespace-nowrap">Possible dupe</Chip>}
                  <IconChevronRight size={18} className="ml-auto shrink-0 text-muted" />
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted">
                  <Chip tone={r.persona_role === "economic_buyer" ? "accent" : "neutral"} className="shrink-0 whitespace-nowrap">
                    {PERSONA_ROLES[r.persona_role as PersonaRole] ?? r.persona_role}
                  </Chip>
                  <span className="min-w-0 truncate">{[r.title, r.account_name ?? "No account"].filter(Boolean).join(" · ")}</span>
                </span>
              </Link>
              <div className="mt-1 flex items-center gap-2">
                <LogButton target={{ contactId: r.id, accountId: r.account_id }} ariaLabel={`Log touch with ${r.name}`} variant="accent-outline" className="shrink-0 px-3" />
                {r.phone && !r.do_not_contact ? (
                  <a href={`tel:${r.phone}`} className={iconBtn} aria-label={`Call ${r.name}`}>
                    <IconPhone size={20} />
                  </a>
                ) : null}
                {r.email && !r.bounced && !r.do_not_contact ? (
                  <a href={`mailto:${r.email}`} className={iconBtn} aria-label={`Email ${r.name}`}>
                    <IconMail size={20} />
                  </a>
                ) : null}
                <span className="num min-w-0 flex-1 truncate text-right text-sm">
                  <span className={cn(r.quiet ? "font-semibold text-warning" : "text-muted")}>{quietLabel(r.days, r.last_touch_at)}</span>
                  {r.bounced && <span className="ml-2 font-semibold text-danger">Bounced</span>}
                  {r.do_not_contact && <span className="ml-2 font-semibold text-danger">Do not contact</span>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {capped && <p className="px-4 py-3 text-sm text-muted">Showing 150. Search or filter to narrow.</p>}
    </div>
  );
}
