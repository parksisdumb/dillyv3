// Shared blocks for contact / property detail: open tasks, opportunities, and contact↔property links.
import Link from "next/link";
import { STAGES, type Stage } from "@/lib/domain/vocab";
import { daysBetween, dueLabel, lateLabel, money } from "@/lib/format";
import { linkPropertyContact, searchContactOptions, searchPropertyOptions, unlinkPropertyContact } from "@/lib/actions/book";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/fields";
import { SearchPicker } from "@/components/ui/search-picker";
import { Chip, SectionTitle } from "@/components/ui/bits";
import { cn } from "@/components/ui/styles";
import { IconChevronRight } from "@/components/icons";

export type TaskLite = { id: string; title: string; due_on: string; reason: string | null };
export type OppLite = { id: string; name: string; stage: string; value_estimate: number | null; next_step: string | null; next_step_due: string | null };
export type LinkLite = { id: string; label: string; sub: string | null; role: string | null };

export function OpenTasks({ tasks, today }: { tasks: TaskLite[]; today: string }) {
  return (
    <>
      <SectionTitle>Open tasks · {tasks.length}</SectionTitle>
      {tasks.length === 0 ? (
        <p className="px-4 text-sm text-muted">Nothing open. Log a touch and the next step sets itself.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {tasks.map((t) => (
            <li key={t.id} className="px-4 py-3">
              <div className="font-semibold">{t.title}</div>
              <div className="text-sm text-muted">
                {t.due_on < today ? <span className="label text-xs text-danger">{lateLabel(daysBetween(t.due_on, today))}</span> : dueLabel(t.due_on, today)}
                {t.reason && <> · {t.reason}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Opportunities({ opps, today, newHref }: { opps: OppLite[]; today: string; newHref?: string }) {
  return (
    <>
      <SectionTitle
        action={
          newHref ? (
            <Link href={newHref} className="label inline-flex min-h-12 items-center px-2 text-xs text-accent">
              + Opportunity
            </Link>
          ) : undefined
        }
      >
        Opportunities · {opps.length}
      </SectionTitle>
      {opps.length === 0 ? (
        <p className="px-4 text-sm text-muted">No open jobs.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {opps.map((o) => (
            <li key={o.id}>
              <Link href={`/app/pipeline/${o.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{o.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Chip tone={o.stage === "won" ? "good" : o.stage === "lost" ? "bad" : "neutral"}>{STAGES[o.stage as Stage] ?? o.stage}</Chip>
                    {o.next_step_due && o.stage !== "won" && o.stage !== "lost" && (
                      <span className={cn(o.next_step_due < today && "font-semibold text-danger")}>
                        {o.next_step_due < today ? lateLabel(daysBetween(o.next_step_due, today)) : dueLabel(o.next_step_due, today)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="num font-display font-bold">{money(o.value_estimate)}</span>
                <IconChevronRight size={18} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Contacts linked to a property (or properties linked to a contact), with role, unlink and a link form. */
export function LinkedList({
  kind,
  selfId,
  links,
}: {
  kind: "contacts" | "properties";
  selfId: string;
  links: LinkLite[];
}) {
  const other = kind === "contacts" ? "contact" : "property";
  const hidden = (otherId: string) =>
    kind === "contacts" ? (
      <>
        <input type="hidden" name="property_id" value={selfId} />
        <input type="hidden" name="contact_id" value={otherId} />
      </>
    ) : (
      <>
        <input type="hidden" name="contact_id" value={selfId} />
        <input type="hidden" name="property_id" value={otherId} />
      </>
    );
  return (
    <>
      <SectionTitle>
        {kind === "contacts" ? "People at this building" : "Buildings"} · {links.length}
      </SectionTitle>
      {links.length > 0 && (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 pl-4 pr-2">
              <Link href={kind === "contacts" ? `/app/contacts/${l.id}` : `/app/properties/${l.id}`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2">
                <span className="truncate font-semibold">{l.label}</span>
                <span className="truncate text-sm text-muted">{[l.role, l.sub].filter(Boolean).join(" · ") || " "}</span>
              </Link>
              <ActionForm action={unlinkPropertyContact} submitLabel="Unlink" submitVariant="secondary" submitSize="md" className="w-28 gap-0">
                {hidden(l.id)}
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <details className="mx-4 mt-2 rounded-lg border-2 border-dashed border-line bg-surface">
        <summary className="label flex min-h-12 cursor-pointer list-none items-center px-3 text-xs text-accent [&::-webkit-details-marker]:hidden">
          + Link a {other}
        </summary>
        <div className="px-3 pb-3">
          <ActionForm action={linkPropertyContact} submitLabel={`Link ${other}`} submitSize="md">
            <input type="hidden" name={kind === "contacts" ? "property_id" : "contact_id"} value={selfId} />
            <SearchPicker
              name={kind === "contacts" ? "contact_id" : "property_id"}
              label={kind === "contacts" ? "Contact" : "Property"}
              search={kind === "contacts" ? searchContactOptions : searchPropertyOptions}
              placeholder={kind === "contacts" ? "Name or email" : "Name, address or city"}
              required
            />
            <TextField label="Role here" name="role" placeholder="Property manager · Maintenance lead" />
          </ActionForm>
        </div>
      </details>
    </>
  );
}
