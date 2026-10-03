// Server-safe display primitives.
import Link from "next/link";
import { cn } from "@/components/ui/styles";
import { TIER_LABEL } from "@/lib/domain/vocab";
import { IconChevronLeft } from "@/components/icons";

export function TierPill({ tier }: { tier: number | null | undefined }) {
  const t = tier ?? 3;
  return (
    <span
      className={cn(
        "label num inline-flex h-6 min-w-8 items-center justify-center rounded px-1.5 text-xs",
        t === 1 && "bg-ink text-ground",
        t === 2 && "border-2 border-ink text-ink",
        t >= 3 && "border border-line text-muted",
      )}
      title={`Priority ${TIER_LABEL(t)}`}
    >
      {TIER_LABEL(t)}
    </span>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent" | "ink";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  good: "bg-success/12 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-danger/12 text-danger",
  accent: "bg-accent/12 text-accent",
  ink: "bg-ink text-ground",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("label inline-flex h-6 items-center rounded px-2 text-xs", tones[tone], className)}>{children}</span>;
}

export const STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "good" },
  cold: { label: "Cold", tone: "warn" },
  not_started: { label: "Not started", tone: "neutral" },
  unassigned: { label: "Unassigned", tone: "neutral" },
  excluded: { label: "Excluded", tone: "bad" },
  do_not_pursue: { label: "Off the list", tone: "bad" },
};

export function StateChip({ state }: { state: string | null | undefined }) {
  const s = STATE_LABEL[state ?? "not_started"] ?? STATE_LABEL.not_started;
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-2 px-4 pt-4">
      <h2 className="label text-sm text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  back,
  action,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  back?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-start gap-2 px-4 pb-2 pt-4">
      {back && (
        <Link href={back} className="-ml-2 inline-flex size-12 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Back">
          <IconChevronLeft />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl font-bold leading-tight">{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-4 rounded-lg border-2 border-dashed border-line px-4 py-8 text-center">
      <p className="font-display text-xl font-bold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label text-xs text-muted">{label}</div>
      <div className="num font-display text-2xl font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="mx-4 my-2 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">{children}</p>;
}

/** Thin horizontal meter used for goals and completion rates. */
export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "success" | "warn" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div
        className={cn("h-full rounded-full", tone === "accent" && "bg-accent", tone === "success" && "bg-success", tone === "warn" && "bg-warning")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
