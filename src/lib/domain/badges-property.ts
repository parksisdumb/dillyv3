// Property badges: what a rep needs to know about a building at a glance (leak, open job type, storm,
// new management, roof system + age, warranty). Pure: computed from property_current columns.
// Not to be confused with ./badges.ts (rep achievements).

export type BadgeTone = "bad" | "warn" | "hot" | "accent" | "info" | "neutral";

export type BadgeIcon =
  | "droplet"
  | "puddle"
  | "hail"
  | "wind"
  | "tear"
  | "flashing"
  | "drain"
  | "ladder"
  | "hazard"
  | "shield"
  | "wrench"
  | "layers"
  | "calendar"
  | "clipboard"
  | "roller"
  | "storm"
  | "door"
  | "roof"
  | "clock"
  | "building";

export type PropertyBadge = { key: string; label: string; icon: BadgeIcon; tone: BadgeTone; priority: number };

export type PropertyBadgeInput = {
  roof_system?: string | null;
  roof_install_year?: number | null;
  warranty_expires_on?: string | null;
  open_service_lines?: string[] | null;
  active_flags?: string[] | null;
  management_changed_on?: string | null;
  ownership_changed_on?: string | null;
  storm_kind?: string | null;
  storm_at?: string | null;
};

// --- Condition flags (one-tap, set by reps) ----------------------------------------------------------------
export const PROPERTY_FLAGS = {
  active_leak: { label: "Leak", long: "Active leak", icon: "droplet", tone: "bad", priority: 10 },
  safety_hazard: { label: "Safety", long: "Safety hazard", icon: "hazard", tone: "bad", priority: 14 },
  hail_damage: { label: "Hail dmg", long: "Hail damage", icon: "hail", tone: "warn", priority: 30 },
  wind_damage: { label: "Wind dmg", long: "Wind damage", icon: "wind", tone: "warn", priority: 32 },
  ponding: { label: "Ponding", long: "Ponding", icon: "puddle", tone: "warn", priority: 33 },
  membrane_damage: { label: "Membrane", long: "Membrane damage", icon: "tear", tone: "warn", priority: 34 },
  flashing_issue: { label: "Flashing", long: "Flashing issue", icon: "flashing", tone: "warn", priority: 35 },
  drainage_issue: { label: "Drainage", long: "Drainage issue", icon: "drain", tone: "warn", priority: 36 },
  insurance_claim: { label: "Claim", long: "Insurance claim", icon: "shield", tone: "info", priority: 37 },
  roof_access_issue: { label: "No access", long: "Roof access issue", icon: "ladder", tone: "neutral", priority: 75 },
} as const satisfies Record<string, { label: string; long: string; icon: BadgeIcon; tone: BadgeTone; priority: number }>;
export type PropertyFlag = keyof typeof PROPERTY_FLAGS;
export const FLAG_KEYS = Object.keys(PROPERTY_FLAGS) as PropertyFlag[];
/** Order for the Condition row on property detail (most common first). */
export const DETAIL_FLAGS: PropertyFlag[] = [
  "active_leak", "ponding", "membrane_damage", "hail_damage", "wind_damage",
  "flashing_issue", "drainage_issue", "safety_hazard", "insurance_claim", "roof_access_issue",
];
/** The three a rep reaches for on a roof: shown as big toggles in the field. */
export const FIELD_FLAGS: PropertyFlag[] = ["active_leak", "ponding", "membrane_damage"];

export function isPropertyFlag(x: string): x is PropertyFlag {
  return x in PROPERTY_FLAGS;
}

// --- Open opportunity type, by service line --------------------------------------------------------------
const SERVICE: Record<string, { label: string; icon: BadgeIcon; tone: BadgeTone; priority: number }> = {
  emergency: { label: "Emergency", icon: "droplet", tone: "bad", priority: 11 },
  repair: { label: "Repair", icon: "wrench", tone: "accent", priority: 20 },
  re_roof: { label: "Re-roof", icon: "layers", tone: "accent", priority: 21 },
  re_cover: { label: "Re-cover", icon: "layers", tone: "accent", priority: 22 },
  coating: { label: "Coating", icon: "roller", tone: "accent", priority: 23 },
  maintenance: { label: "Maintenance", icon: "calendar", tone: "accent", priority: 24 },
  inspection: { label: "Inspection", icon: "clipboard", tone: "accent", priority: 25 },
  insurance_claim: { label: "Claim", icon: "shield", tone: "accent", priority: 26 },
  new_construction: { label: "New build", icon: "building", tone: "accent", priority: 27 },
  tenant_improvement: { label: "TI", icon: "building", tone: "accent", priority: 27 },
  envelope: { label: "Envelope", icon: "building", tone: "accent", priority: 27 },
  other: { label: "Open job", icon: "clipboard", tone: "accent", priority: 28 },
};

/** Badge for an opportunity's type (pipeline cards). */
export function serviceLineBadge(serviceLine: string | null | undefined): PropertyBadge | null {
  if (!serviceLine) return null;
  const s = SERVICE[serviceLine] ?? SERVICE.other;
  return { key: `opp:${serviceLine}`, ...s };
}

// --- Roof system -------------------------------------------------------------------------------------------
const ROOF_SYSTEMS: [RegExp, string][] = [
  [/\btpo\b/i, "TPO"],
  [/\bepdm\b|rubber/i, "EPDM"],
  [/\bpvc\b/i, "PVC"],
  [/mod[\s_-]*bit|modified|\bsbs\b|\bapp\b/i, "Mod-bit"],
  [/\bbur\b|built[\s_-]*up/i, "BUR"],
  [/metal|standing seam/i, "Metal"],
  [/shingle|asphalt/i, "Shingle"],
  [/coat|silicone|acrylic|spf|foam/i, "Coating"],
  [/tile|slate/i, "Tile"],
];

/** Short display label for a free-text roof system; null when unknown. */
export function roofSystemLabel(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t || /^(unknown|n\/?a|none|-+|\?)$/i.test(t)) return null;
  for (const [re, label] of ROOF_SYSTEMS) if (re.test(t)) return label;
  return t.length <= 10 ? t : `${t.slice(0, 9)}…`;
}

const DAY = 86_400_000;
function dayNum(d: string): number {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / DAY;
}
function daysFrom(from: string, to: string): number {
  return Math.round(dayNum(to) - dayNum(from));
}

export const NEW_PARTY_DAYS = 90;
export const STORM_DAYS = 30;

/**
 * All badges for a property, most important first:
 * leak / emergency → open job types → storm + damage conditions → new management/owner → roof system + age → warranty.
 * `today` is the tenant-local YYYY-MM-DD.
 */
export function propertyBadges(p: PropertyBadgeInput, today: string): PropertyBadge[] {
  const out: PropertyBadge[] = [];
  const flags = new Set((p.active_flags ?? []).filter(isPropertyFlag));
  const lines = new Set(p.open_service_lines ?? []);

  for (const f of flags) {
    const d = PROPERTY_FLAGS[f];
    out.push({ key: `flag:${f}`, label: d.label, icon: d.icon, tone: d.tone, priority: d.priority });
  }
  for (const l of lines) {
    if (l === "emergency" && flags.has("active_leak")) continue; // one droplet is enough
    if (l === "insurance_claim" && flags.has("insurance_claim")) continue;
    const b = serviceLineBadge(l);
    if (b) out.push(b);
  }

  if (p.storm_kind && (!p.storm_at || daysFrom(p.storm_at, today) <= STORM_DAYS)) {
    const k = p.storm_kind.toLowerCase();
    const hail = k.includes("hail");
    const wind = !hail && (k.includes("wind") || k.includes("tornado"));
    if (!(hail && flags.has("hail_damage")) && !(wind && flags.has("wind_damage"))) {
      out.push({
        key: "storm",
        label: hail ? "Hail hit" : wind ? "Wind event" : "Storm",
        icon: hail ? "hail" : wind ? "wind" : "storm",
        tone: "warn",
        priority: 31,
      });
    }
  }

  const recent = (d: string | null | undefined) => d != null && daysFrom(d, today) <= NEW_PARTY_DAYS && daysFrom(d, today) >= -NEW_PARTY_DAYS;
  if (recent(p.management_changed_on)) out.push({ key: "new_mgmt", label: "New mgmt", icon: "door", tone: "hot", priority: 50 });
  if (recent(p.ownership_changed_on)) out.push({ key: "new_owner", label: "New owner", icon: "door", tone: "hot", priority: 51 });

  const sys = roofSystemLabel(p.roof_system);
  out.push({ key: "roof", label: sys ?? "Roof unknown", icon: "roof", tone: "neutral", priority: sys ? 60 : 80 });

  if (p.roof_install_year) {
    const age = Math.max(0, Number(today.slice(0, 4)) - p.roof_install_year);
    out.push({ key: "age", label: `${age} yrs`, icon: "clock", tone: age >= 20 ? "bad" : age >= 15 ? "warn" : "neutral", priority: 61 });
  }

  if (p.warranty_expires_on) {
    const left = daysFrom(today, p.warranty_expires_on);
    if (left < 0) out.push({ key: "warranty", label: "Warranty out", icon: "shield", tone: "warn", priority: 70 });
    else if (left <= 365) {
      const mo = Math.max(1, Math.round(left / 30));
      out.push({ key: "warranty", label: `Warranty ${mo}mo`, icon: "shield", tone: "warn", priority: 70 });
    }
  }

  return out.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

/** First `max` badges plus how many were left off (rendered as "+N"). */
export function visibleBadges(badges: PropertyBadge[], max: number): { shown: PropertyBadge[]; more: number } {
  return { shown: badges.slice(0, max), more: Math.max(0, badges.length - max) };
}
