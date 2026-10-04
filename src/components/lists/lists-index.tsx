import Link from "next/link";
import { Chip, Empty, SectionTitle } from "@/components/ui/bits";
import { IconChevronRight, IconList, IconTarget } from "@/components/icons";

export type ListCard = {
  id: string;
  name: string;
  kind: "static" | "smart";
  createdFrom: string;
  n: number | null;
  capped?: boolean;
  /** "Kayla, Colby" (managers see who has it). */
  assignedTo?: string | null;
  sub?: string | null;
};

export type ListGroup = { title: string; lists: ListCard[]; empty?: string };

function Row({ l }: { l: ListCard }) {
  return (
    <li>
      <Link href={`/app/lists/${l.id}`} className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-surface-2">
        {l.createdFrom === "system" ? <IconTarget size={20} className="shrink-0 text-accent" /> : <IconList size={20} className="shrink-0 text-muted" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{l.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{l.kind === "smart" ? "Updates itself" : "Hand-picked"}</span>
            {l.assignedTo && <span>· {l.assignedTo}</span>}
            {l.sub && <span>· {l.sub}</span>}
          </span>
        </span>
        {l.n != null && (
          <Chip tone={l.n > 0 ? "ink" : "neutral"} className="num">
            {l.n}
            {l.capped ? "+" : ""}
          </Chip>
        )}
        <IconChevronRight size={20} className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}

/** Properties → Lists tab. */
export function ListsIndex({ groups }: { groups: ListGroup[] }) {
  const any = groups.some((g) => g.lists.length);
  return (
    <div className="pb-4">
      {!any && <Empty title="No lists yet">Filter Properties and tap Save as list, or select rows and Add to list.</Empty>}
      {groups
        .filter((g) => g.lists.length || g.empty)
        .map((g) => (
          <section key={g.title} aria-label={g.title}>
            <SectionTitle>{g.title}</SectionTitle>
            {g.lists.length ? (
              <ul className="divide-y divide-line border-y border-line bg-surface">
                {g.lists.map((l) => (
                  <Row key={l.id} l={l} />
                ))}
              </ul>
            ) : (
              <p className="px-4 text-sm text-muted">{g.empty}</p>
            )}
          </section>
        ))}
    </div>
  );
}
