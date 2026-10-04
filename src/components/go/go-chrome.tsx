import Link from "next/link";
import { cn } from "@/components/ui/styles";

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
