// Property badges: icon + 1–2 word label. Server-safe (no hooks).
import type { BadgeIcon, BadgeTone, PropertyBadge } from "@/lib/domain/badges-property";
import { visibleBadges } from "@/lib/domain/badges-property";
import { cn } from "@/components/ui/styles";
import {
  IconAlert,
  IconBuilding,
  IconCalendar,
  IconClipboard,
  IconClock,
  IconDoor,
  IconDrain,
  IconDroplet,
  IconFlashing,
  IconHail,
  IconLadder,
  IconLayers,
  IconPuddle,
  IconRoller,
  IconRoof,
  IconShield,
  IconStorm,
  IconTear,
  IconWind,
  IconWrench,
} from "@/components/icons";

type IconCmp = (p: { size?: number; className?: string }) => React.ReactNode;

export const BADGE_ICONS: Record<BadgeIcon, IconCmp> = {
  droplet: IconDroplet,
  puddle: IconPuddle,
  hail: IconHail,
  wind: IconWind,
  tear: IconTear,
  flashing: IconFlashing,
  drain: IconDrain,
  ladder: IconLadder,
  hazard: IconAlert,
  shield: IconShield,
  wrench: IconWrench,
  layers: IconLayers,
  calendar: IconCalendar,
  clipboard: IconClipboard,
  roller: IconRoller,
  storm: IconStorm,
  door: IconDoor,
  roof: IconRoof,
  clock: IconClock,
  building: IconBuilding,
};

export const BADGE_TONES: Record<BadgeTone, string> = {
  bad: "bg-danger text-white",
  warn: "bg-warning/18 text-ink [&_svg]:text-warning",
  hot: "bg-accent text-accent-ink",
  accent: "bg-accent/12 text-ink [&_svg]:text-accent",
  info: "bg-focus/12 text-ink [&_svg]:text-focus",
  neutral: "bg-surface-2 text-ink [&_svg]:text-muted",
};

export function BadgeChip({ b, className }: { b: Pick<PropertyBadge, "label" | "icon" | "tone">; className?: string }) {
  const Icon = BADGE_ICONS[b.icon];
  return (
    <span className={cn("label inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-xs", BADGE_TONES[b.tone], className)}>
      <Icon size={14} className="shrink-0" />
      {b.label}
    </span>
  );
}

/** A row of badges. Lists pass max={3} and get "+N"; detail screens show everything. */
export function PropertyBadges({ badges, max, className, label }: { badges: PropertyBadge[]; max?: number; className?: string; label?: string }) {
  if (badges.length === 0) return null;
  const { shown, more } = visibleBadges(badges, max ?? badges.length);
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)} aria-label={label ?? `Badges: ${badges.map((b) => b.label).join(", ")}`} role="group">
      {shown.map((b, i) =>
        more > 0 && i === shown.length - 1 ? (
          // Keep "+N" glued to the last chip so it never wraps onto a line of its own.
          <span key={b.key} className="inline-flex items-center gap-1 whitespace-nowrap">
            <BadgeChip b={b} />
            <span className="label num inline-flex h-6 items-center px-0.5 text-xs text-muted" aria-hidden="true">
              +{more}
            </span>
          </span>
        ) : (
          <BadgeChip key={b.key} b={b} />
        ),
      )}
    </span>
  );
}
