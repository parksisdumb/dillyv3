import Link from "next/link";
import { PageHeader } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { IconPlus } from "@/components/icons";

export function GoHeader({ mode }: { mode: "field" | "focus" }) {
  return (
    <>
      <PageHeader
        title={mode === "field" ? "Field session" : "Focus session"}
        action={
          mode === "field" ? (
            <Link href="/app/contacts/new?source=field&back=/app/go" className={btn("secondary", "md", "shrink-0")}>
              <IconPlus size={18} /> Person
            </Link>
          ) : undefined
        }
      />
      <div className="mx-4 mb-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Session type">
        {(["field", "focus"] as const).map((m) => (
          <Link
            key={m}
            role="tab"
            aria-selected={mode === m}
            href={m === "field" ? "/app/go" : "/app/go?mode=focus"}
            className={cn("label flex min-h-12 items-center justify-center rounded-md text-sm", mode === m ? "bg-ink text-ground" : "text-ink")}
          >
            {m === "field" ? "In person" : "Calls"}
          </Link>
        ))}
      </div>
    </>
  );
}

export function CityChips({ cities, city }: { cities: { city: string; total: number }[]; city: string | undefined }) {
  return (
    <>
      {cities.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2" role="group" aria-label="Area">
          {cities.map((c) => (
            <Link
              key={c.city}
              href={`/app/go?city=${encodeURIComponent(c.city)}`}
              aria-current={c.city === city ? "true" : undefined}
              className={cn(
                "label inline-flex min-h-12 shrink-0 items-center whitespace-nowrap gap-1 rounded-full border-2 px-4 text-sm",
                c.city === city ? "border-ink bg-ink text-ground" : "border-line",
              )}
            >
              {c.city}
              <span className="num opacity-70">{c.total}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
