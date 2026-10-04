import type { Metadata } from "next";
import Link from "next/link";
import { pageBody } from "@/components/status/page-boundary";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { loadWorking } from "@/lib/server/working";
import { Chip, Empty, PageHeader } from "@/components/ui/bits";
import { STALE_DAYS } from "@/lib/lists/order";

export const metadata: Metadata = { title: "Who's working what" };

function ago(days: number | null) {
  if (days == null) return "no touch yet";
  if (days === 0) return "touched today";
  return `${days}d since touch`;
}

async function WorkingBody() {
  const c = await ctx();
  requireManager(c.s);
  const reps = await loadWorking(c);
  const total = reps.reduce((n, r) => n + r.active, 0);
  const stale = reps.reduce((n, r) => n + r.stale, 0);
  return (
    <div>
      <PageHeader back="/app/team" title="Who's working what" sub={`${total} active properties · ${stale} stale (no touch in ${STALE_DAYS}+ days)`} />
      {total === 0 && <Empty title="Nobody has anything active">Reps tap Active on the properties they&apos;re pursuing.</Empty>}
      <div className="flex flex-col gap-3 px-4 md:grid md:grid-cols-2">
        {reps
          .filter((r) => r.active > 0)
          .map((r) => (
            <section key={r.user_id} aria-label={r.name} className="rounded-lg border-2 border-line bg-surface">
              <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold">{r.name}</h2>
                <span className="num font-display text-xl font-bold">{r.active}</span>
                {r.stale > 0 && <Chip tone="warn">{r.stale} stale</Chip>}
              </header>
              <ul className="divide-y divide-line">
                {r.items.slice(0, 12).map((i) => (
                  <li key={i.propertyId}>
                    <Link href={`/app/properties/${i.propertyId}`} className="flex min-h-12 items-center gap-2 px-3 py-1 text-sm hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{i.name}</span>
                        {i.city && <span className="block truncate text-xs text-muted">{i.city}</span>}
                      </span>
                      <span className={i.stale ? "num shrink-0 font-semibold text-warning" : "num shrink-0 text-muted"}>{ago(i.days)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {r.items.length > 12 && <p className="px-3 py-2 text-xs text-muted">+{r.items.length - 12} more</p>}
            </section>
          ))}
      </div>
      {total > 0 && reps.some((r) => r.active === 0) && (
        <p className="px-4 pt-3 text-sm text-muted">Nothing active: {reps.filter((r) => r.active === 0).map((r) => r.name).join(", ")}</p>
      )}
    </div>
  );
}

export default function WorkingPage() {
  return pageBody(() => WorkingBody());
}
