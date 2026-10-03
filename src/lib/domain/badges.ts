// Badges (08-DILLY-V2-AUDIT §4). Pure: computed from point_event and rep_day rows, nothing stored.

export type BadgeKey = "clean_sheet" | "door_opener" | "card_collector" | "host" | "closer" | "rescue";

export type Badge = {
  key: BadgeKey;
  label: string;
  description: string;
  earned: boolean;
  progress: number; // toward target, capped at target
  target: number;
};

export type BadgePointEvent = { event: string; occurred_at: string; voided?: boolean | null };
export type BadgeRepDay = { day: string; cleared: boolean };

export type BadgeInput = {
  pointEvents: BadgePointEvent[];
  repDays: BadgeRepDay[];
  /** Tenant-local "today" as YYYY-MM-DD; "this month" is the calendar month of this date. */
  today: string;
  /** IANA zone used to place point events in a local month. */
  timeZone: string;
};

const DEFS: Record<BadgeKey, { label: string; description: string; target: number }> = {
  clean_sheet: { label: "Clean Sheet", description: "5 cleared weekdays in a row", target: 5 },
  door_opener: { label: "Door Opener", description: "10 decision-maker conversations this month", target: 10 },
  card_collector: { label: "Card Collector", description: "25 new field contacts this month", target: 25 },
  host: { label: "Host", description: "Hosted a lunch & learn", target: 1 },
  closer: { label: "Closer", description: "Won a job", target: 1 },
  rescue: { label: "Rescue", description: "5 cold accounts brought back", target: 5 },
};

function localMonth(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
}

function isWeekday(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6;
}

function stepWeekday(day: string, dir: 1 | -1): string {
  const [y, m, d] = day.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  do {
    t += dir * 86_400_000;
  } while ([0, 6].includes(new Date(t).getUTCDay()));
  return new Date(t).toISOString().slice(0, 10);
}

/** Longest run of consecutive cleared weekdays (weekends are skipped, a missing weekday breaks the run). */
export function longestClearedRun(repDays: BadgeRepDay[]): number {
  const cleared = new Set(repDays.filter((d) => d.cleared && isWeekday(d.day.slice(0, 10))).map((d) => d.day.slice(0, 10)));
  let best = 0;
  for (const day of cleared) {
    if (cleared.has(stepWeekday(day, -1))) continue; // not the start of a run
    let len = 0;
    let cur = day;
    while (cleared.has(cur)) {
      len++;
      cur = stepWeekday(cur, 1);
    }
    best = Math.max(best, len);
  }
  return best;
}

export function computeBadges({ pointEvents, repDays, today, timeZone }: BadgeInput): Badge[] {
  const month = today.slice(0, 7);
  const live = pointEvents.filter((e) => !e.voided);
  const count = (event: string, thisMonth: boolean) =>
    live.filter((e) => e.event === event && (!thisMonth || localMonth(e.occurred_at, timeZone) === month)).length;

  const progress: Record<BadgeKey, number> = {
    clean_sheet: longestClearedRun(repDays),
    door_opener: count("decision_maker_conversation", true),
    card_collector: count("field_contact_created", true),
    host: count("lunch_and_learn", false),
    closer: count("won", false),
    rescue: count("cold_rescued", false),
  };

  return (Object.keys(DEFS) as BadgeKey[]).map((key) => {
    const def = DEFS[key];
    const p = progress[key];
    return { key, ...def, earned: p >= def.target, progress: Math.min(p, def.target) };
  });
}
