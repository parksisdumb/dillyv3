/**
 * I/O for the Rep Daily Brief: load everything rank.ts needs for one (tenant, rep, day), and write the brief.
 * Kept separate so the agent can be exercised with fakes.
 */
import type { Tables } from "@/lib/db/database.types";
import { addDays, daysBetween, isWeekend, localClock } from "../runtime/clock";
import { must, mustRow, toJson, type Db } from "../runtime/db";
import type { BriefContent } from "./template";
import {
  settingsFromTenant,
  type BriefSettings,
  type NewSignal,
  type OpenOpportunity,
  type QueueRow,
  type RankedItem,
  type TodayAppointment,
} from "./rank";

export interface TenantInfo {
  id: string;
  name: string;
  timezone: string;
  settings: BriefSettings;
  /** Roles that get a brief and reminders: tenant.settings.brief_roles, default ['rep']. */
  briefRoles: string[];
}

const ROLES = new Set(["owner", "admin", "manager", "rep", "estimator", "pm", "reviewer"]);

export function briefRolesFrom(raw: unknown): string[] {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).brief_roles : null;
  const roles = Array.isArray(r) ? r.filter((x): x is string => typeof x === "string" && ROLES.has(x)) : [];
  return roles.length ? roles : ["rep"];
}

export interface RepContext {
  tenant: TenantInfo;
  userId: string;
  repName: string | null;
  forDate: string;
  queue: QueueRow[];
  opportunities: OpenOpportunity[];
  signals: NewSignal[];
  doNotPursueAccountIds: string[];
  newAssignments: number;
  yesterday: Pick<Tables<"rep_day">, "day" | "touches" | "tasks_completed" | "overdue_eod" | "cleared"> | null;
  streak: number;
  signalsSince: string;
  /** Today's scheduled appointments assigned to the rep (company-local day). */
  appointments?: TodayAppointment[];
}

const MAX_LOOKBACK_HOURS = 72;

export async function loadTenant(db: Db, tenantId: string): Promise<TenantInfo> {
  const t = mustRow(
    await db.from("tenant").select("id, name, timezone, settings").eq("id", tenantId).single(),
    "load tenant",
  );
  return {
    id: t.id,
    name: t.name,
    timezone: t.timezone,
    settings: settingsFromTenant(t.timezone, t.settings),
    briefRoles: briefRolesFrom(t.settings),
  };
}

function previousWeekday(date: string): string {
  let d = addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

export async function loadRepContext(
  db: Db,
  tenantId: string,
  userId: string,
  forDate?: string,
  now: Date = new Date(),
): Promise<RepContext> {
  const tenant = await loadTenant(db, tenantId);
  const day = forDate ?? localClock(tenant.timezone, now).date;

  const [queueRes, oppRes, profileRes, prevBriefRes, yRes, streakRes, appointments] = await Promise.all([
    db.rpc("rep_queue", { p_tenant: tenantId, p_user: userId, p_day: day }),
    db
      .from("opportunity")
      .select("id, name, account_id, stage, value_estimate, next_step, next_step_due, stage_changed_at")
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", userId)
      .eq("is_test", false)
      .not("stage", "in", "(won,lost)"),
    db.from("profile").select("full_name").eq("id", userId).maybeSingle(),
    db
      .from("brief")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .lt("for_date", day)
      .order("for_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("rep_day")
      .select("day, touches, tasks_completed, overdue_eod, cleared")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("day", previousWeekday(day))
      .maybeSingle(),
    db.rpc("rep_streak", { p_tenant: tenantId, p_user: userId }),
    loadTodayAppointments(db, tenantId, userId, day, tenant.timezone),
  ]);
  const queue = must(queueRes, "rep_queue") ?? [];
  const oppRows = must(oppRes, "load opportunities") ?? [];
  const profile = must(profileRes, "load profile");
  const prevBrief = must(prevBriefRes, "load previous brief");
  const yesterday = must(yRes, "load rep_day");
  const streak = must(streakRes, "rep_streak") ?? 0;

  // "New" = since the last brief, bounded to 72h (covers a weekend), at least 24h.
  const floor = new Date(now.getTime() - MAX_LOOKBACK_HOURS * 3_600_000);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
  let since = prevBrief?.created_at ? new Date(prevBrief.created_at) : dayAgo;
  if (since < floor) since = floor;
  if (since > dayAgo) since = dayAgo;
  const sinceIso = since.toISOString();

  const [sigRes, assignRes] = await Promise.all([
    db
      .from("signal")
      .select("id, kind, headline, account_id, occurred_at, weight, expires_at")
      .eq("tenant_id", tenantId)
      .gte("occurred_at", sinceIso)
      .not("account_id", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(200),
    db
      .from("account")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", userId)
      .gte("created_at", sinceIso),
  ]);
  const sigRows = (must(sigRes, "load signals") ?? []).filter((s) => !s.expires_at || s.expires_at > now.toISOString());
  if (assignRes.error) throw new Error(`count assignments: ${assignRes.error.message}`);

  // Owned accounts among the signal + opportunity accounts, with names and do-not-pursue flags.
  const accountIds = [
    ...new Set([...sigRows.map((s) => s.account_id), ...oppRows.map((o) => o.account_id)].filter((x): x is string => !!x)),
  ];
  const accounts = new Map<string, { name: string; owner: string | null }>();
  const dnp = new Set<string>();
  if (accountIds.length) {
    const [accRes, prefRes] = await Promise.all([
      db.from("account").select("id, name, owner_user_id").eq("tenant_id", tenantId).in("id", accountIds),
      db
        .from("account_preference")
        .select("account_id, preference, expires_on")
        .eq("tenant_id", tenantId)
        .in("account_id", accountIds)
        .in("preference", ["do_not_pursue", "competitor"]),
    ]);
    for (const a of must(accRes, "load accounts") ?? []) accounts.set(a.id, { name: a.name, owner: a.owner_user_id });
    for (const p of must(prefRes, "load account preferences") ?? []) {
      if (!p.expires_on || p.expires_on >= day) dnp.add(p.account_id);
    }
  }

  const opportunities: OpenOpportunity[] = oppRows.map((o) => ({
    id: o.id,
    name: o.name,
    accountId: o.account_id,
    accountName: o.account_id ? accounts.get(o.account_id)?.name ?? null : null,
    value: o.value_estimate === null ? null : Number(o.value_estimate),
    stage: o.stage,
    daysInStage: Math.max(daysBetween(localClock(tenant.timezone, new Date(o.stage_changed_at)).date, day), 0),
    nextStep: o.next_step,
    nextStepDue: o.next_step_due,
  }));

  const signals: NewSignal[] = sigRows
    .filter((s) => s.account_id && accounts.get(s.account_id)?.owner === userId)
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      headline: s.headline,
      accountId: s.account_id,
      accountName: accounts.get(s.account_id!)?.name ?? null,
      occurredAt: s.occurred_at,
      weight: Number(s.weight),
    }));

  return {
    tenant,
    userId,
    repName: profile?.full_name ?? null,
    forDate: day,
    queue,
    opportunities,
    signals,
    doNotPursueAccountIds: [...dnp],
    newAssignments: assignRes.count ?? 0,
    yesterday: yesterday ?? null,
    streak: Number(streak),
    signalsSince: sinceIso,
    appointments,
  };
}

/** UTC instant of local midnight starting `day` in `timeZone`. */
function localMidnightUtc(day: string, timeZone: string): Date {
  const noon = new Date(`${day}T12:00:00Z`);
  const c = localClock(timeZone, noon);
  const offsetMin = (c.hour - 12) * 60 + c.minute; // e.g. Chicago CDT: 07:00 local at 12:00Z → -300
  return new Date(Date.parse(`${day}T00:00:00Z`) - offsetMin * 60000);
}

/** Today's scheduled appointments for one rep, with place + building count, in time order. */
export async function loadTodayAppointments(db: Db, tenantId: string, userId: string, day: string, timeZone: string): Promise<TodayAppointment[]> {
  const from = localMidnightUtc(day, timeZone);
  const to = localMidnightUtc(addDays(day, 1), timeZone);
  const rows =
    must(
      await db
        .from("appointment")
        .select("id,title,kind,starts_at,all_day,location,account_id,reminder_minutes")
        .eq("tenant_id", tenantId)
        .eq("assigned_user_id", userId)
        .eq("status", "scheduled")
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at"),
      "load appointments",
    ) ?? [];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const acctIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const [links, accts] = await Promise.all([
    db.from("appointment_property").select("appointment_id").eq("tenant_id", tenantId).in("appointment_id", ids),
    acctIds.length ? db.from("account").select("id,name").in("id", acctIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = new Map((accts.data ?? []).map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    startsAt: r.starts_at,
    allDay: r.all_day,
    place: r.location,
    buildings: (links.data ?? []).filter((l) => l.appointment_id === r.id).length,
    accountId: r.account_id,
    accountName: r.account_id ? names.get(r.account_id) ?? null : null,
    reminderMinutes: r.reminder_minutes,
  }));
}

export interface BriefRow {
  tenantId: string;
  userId: string;
  forDate: string;
  content: BriefContent;
  queue: RankedItem[];
  runId: string;
}

export const QUEUE_STORE_LIMIT = 50;

/** Upsert public.brief on (tenant_id, user_id, for_date). seen_at is left untouched on re-runs. */
export async function writeBrief(db: Db, b: BriefRow): Promise<void> {
  must(
    await db.from("brief").upsert(
      {
        tenant_id: b.tenantId,
        user_id: b.userId,
        for_date: b.forDate,
        headline: b.content.headline,
        lines: toJson(b.content.lines),
        queue: toJson(b.queue.slice(0, QUEUE_STORE_LIMIT)),
        agent_run_id: b.runId,
      },
      { onConflict: "tenant_id,user_id,for_date" },
    ),
    "upsert brief",
  );
}

/** Active members who get a brief (roles from TenantInfo.briefRoles). */
export async function activeReps(db: Db, tenantId: string, roles: string[] = ["rep"]): Promise<string[]> {
  const rows = must(
    await db.from("membership").select("user_id").eq("tenant_id", tenantId).eq("active", true).in("role", roles),
    "load memberships",
  );
  return (rows ?? []).map((r) => r.user_id);
}
