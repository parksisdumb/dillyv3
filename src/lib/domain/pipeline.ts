import { STALL_DAYS, type Stage } from "@/lib/domain/vocab";

/** Whole days an opportunity has sat in its stage, measured on tenant-local dates. */
export function daysInStage(stageChangedAt: string, today: string): number {
  const a = Date.parse(stageChangedAt.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function isStalled(stage: string, days: number): boolean {
  const limit = STALL_DAYS[stage as Stage];
  return limit != null && days > limit;
}
