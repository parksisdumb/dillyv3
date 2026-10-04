import Link from "next/link";
import { cn } from "@/components/ui/styles";

export type PropertyTab = "active" | "lists" | "all";

const TABS: { key: PropertyTab; label: string }[] = [
  { key: "active", label: "My active" },
  { key: "lists", label: "Lists" },
  { key: "all", label: "All" },
];

/** Properties: what I'm working (My active) · lists (assigned, mine, team, system) · the whole book. */
export function PropertyTabs({ tab, activeCount }: { tab: PropertyTab; activeCount: number }) {
  return (
    <nav aria-label="Property views" className="mx-4 mt-3 flex gap-1 border-b-2 border-line">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/app/properties?tab=${t.key}`}
          aria-current={tab === t.key ? "page" : undefined}
          className={cn(
            "label -mb-0.5 inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 border-b-4 text-sm",
            tab === t.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.key === "active" && activeCount > 0 && <span className="num rounded bg-surface-2 px-1.5 text-xs text-ink">{activeCount}</span>}
        </Link>
      ))}
    </nav>
  );
}
