/**
 * Loading skeletons for loading.tsx files. Server components, no data, no JS — they paint instantly from
 * the streamed shell so a rep on one bar sees the page shape right away. Shapes mirror the real layouts
 * (PageHeader, filter row, divided list rows, stat grid) so nothing jumps when data lands.
 */
import { cn } from "@/components/ui/styles";

export function Bone({ className }: { className?: string }) {
  // No tailwind-merge here: only add the default radius when the caller didn't pick one.
  return <span aria-hidden className={cn("block animate-pulse bg-surface-2", !/\brounded-/.test(className ?? "") && "rounded-md", className)} />;
}

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

export function HeaderSkeleton({ sub = true, back = false }: { sub?: boolean; back?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-4 pb-2 pt-4">
      {back && <Bone className="-ml-1 size-10 shrink-0" />}
      <div className="min-w-0 flex-1">
        <Bone className="h-7 w-40" />
        {sub && <Bone className="mt-2 h-4 w-56" />}
      </div>
    </div>
  );
}

export function RowsSkeleton({ rows = 8, meta = true }: { rows?: number; meta?: boolean }) {
  return (
    <ul className="mt-3 divide-y divide-line border-y border-line bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
          <Bone className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Bone className={cn("h-4", i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-2/3" : "w-1/2")} />
            {meta && <Bone className="mt-2 h-3 w-1/3" />}
          </div>
          <Bone className="h-4 w-10 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function SearchSkeleton({ chips = 4 }: { chips?: number }) {
  return (
    <div className="mt-3 flex flex-col gap-2 px-4">
      <Bone className="h-12 w-full rounded-lg" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: chips }, (_, i) => (
          <Bone key={i} className="h-9 w-20 shrink-0 rounded-full" />
        ))}
      </div>
    </div>
  );
}

export function StatsSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 px-4 pt-4 sm:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <Bone className="h-3 w-16" />
          <Bone className="mt-2 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div className="flex min-h-12 items-center px-4 pt-4">
      <Bone className="h-4 w-28" />
    </div>
  );
}

// --- Per-tab skeletons -------------------------------------------------------------------------------

export function TodaySkeleton() {
  return (
    <Busy label="Today">
      {/* brief card */}
      <div className="mx-4 mt-4 rounded-lg border-l-4 border-line bg-surface px-4 py-3">
        <Bone className="h-3 w-20" />
        <Bone className="mt-2 h-6 w-4/5" />
        <Bone className="mt-3 h-4 w-3/5" />
        <Bone className="mt-2 h-4 w-2/3" />
      </div>
      {/* progress ring + stats */}
      <div className="flex items-center gap-5 px-4 pt-5">
        <Bone className="size-24 shrink-0 rounded-full" />
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Bone className="h-3 w-14" />
              <Bone className="mt-2 h-6 w-10" />
            </div>
          ))}
        </div>
      </div>
      <SectionSkeleton />
      <RowsSkeleton rows={6} />
    </Busy>
  );
}

export function ListPageSkeleton({ label, chips = 4, rows = 10 }: { label: string; chips?: number; rows?: number }) {
  return (
    <Busy label={label}>
      <HeaderSkeleton />
      <SearchSkeleton chips={chips} />
      <RowsSkeleton rows={rows} />
    </Busy>
  );
}

export function DetailSkeleton({ label }: { label: string }) {
  return (
    <Busy label={label}>
      <HeaderSkeleton back />
      <div className="flex gap-2 px-4 pt-2">
        <Bone className="h-12 flex-1 rounded-lg" />
        <Bone className="h-12 flex-1 rounded-lg" />
        <Bone className="h-12 flex-1 rounded-lg" />
      </div>
      <StatsSkeleton n={4} />
      <SectionSkeleton />
      <RowsSkeleton rows={3} />
      <SectionSkeleton />
      <RowsSkeleton rows={4} />
    </Busy>
  );
}

export function GoSkeleton() {
  return (
    <Busy label="Go">
      <HeaderSkeleton />
      <div className="mx-4 mb-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
        <Bone className="h-11 rounded-md bg-surface" />
        <Bone className="h-11 rounded-md" />
      </div>
      <div className="flex gap-2 overflow-hidden px-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mx-4 mt-4 rounded-lg border-2 border-line bg-surface px-4 py-5">
        <Bone className="h-3 w-24" />
        <Bone className="mt-2 h-7 w-3/4" />
        <Bone className="mt-2 h-4 w-1/2" />
        <div className="mt-5 grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Bone key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    </Busy>
  );
}

export function PipelineSkeleton() {
  return (
    <Busy label="Pipeline">
      <HeaderSkeleton />
      <StatsSkeleton n={3} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i}>
          <SectionSkeleton />
          <RowsSkeleton rows={2} />
        </div>
      ))}
    </Busy>
  );
}

export function TeamSkeleton() {
  return (
    <Busy label="Team">
      <HeaderSkeleton />
      <div className="grid grid-cols-1 gap-3 px-4 pt-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border-2 border-line bg-surface px-4 py-3">
            <Bone className="h-4 w-32" />
            {Array.from({ length: 4 }, (_, j) => (
              <Bone key={j} className="mt-3 h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function MeSkeleton() {
  return (
    <Busy label="your stats">
      <HeaderSkeleton />
      <StatsSkeleton n={4} />
      <SectionSkeleton />
      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <SectionSkeleton />
      <RowsSkeleton rows={5} meta={false} />
    </Busy>
  );
}

export function FormPageSkeleton({ label }: { label: string }) {
  return (
    <Busy label={label}>
      <HeaderSkeleton />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i}>
          <SectionSkeleton />
          <div className="flex flex-col gap-3 border-y border-line bg-surface px-4 py-4">
            <Bone className="h-12 w-full rounded-lg" />
            <Bone className="h-12 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </Busy>
  );
}
