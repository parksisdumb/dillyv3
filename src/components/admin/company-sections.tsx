// Admin → Company sections (server components). Targeting + team goal moved here from Settings.
import { saveTargeting, deleteTargeting, saveTeamGoal, saveScorecardTargets } from "@/lib/actions/settings";
import { addMarket, saveCompany, saveNotificationRules, setMarketRole } from "@/lib/actions/admin";
import { ACCOUNT_TYPES, SERVICE_LINES } from "@/lib/domain/vocab";
import { GOAL_EVENTS, type TeamGoal } from "@/lib/domain/team-goal";
import type { Targets } from "@/lib/domain/scorecard";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/fields";
import { Chip, SectionTitle } from "@/components/ui/bits";
import { RunButton } from "@/components/ui/run-button";

const DIMENSIONS = { service_line: "Service line", account_type: "Account type", asset_class: "Asset class", market: "Market" } as const;
export const TIMEZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
] as const;

export function CompanyBasics({ t }: { t: { name: string; brand_name: string | null; timezone: string } }) {
  return (
    <>
      <SectionTitle>Company</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveCompany} submitLabel="Save company" submitVariant="secondary" className="px-4">
          <TextField label="Company name" name="name" required defaultValue={t.name} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Brand name" name="brand_name" defaultValue={t.brand_name} hint="What customers see on emails and cards" />
            <SelectField label="Time zone" name="timezone" options={TIMEZONES.map(([value, label]) => ({ value, label }))} defaultValue={t.timezone} hint="Today, reminders and streaks follow this clock" />
          </div>
        </ActionForm>
      </div>
    </>
  );
}

export function MarketsSection({ mine, all }: { mine: { slug: string; name: string; role: string }[]; all: { slug: string; name: string; state: string }[] }) {
  const have = new Set(mine.map((m) => m.slug));
  return (
    <>
      <SectionTitle>Markets served</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface">
        {mine.map((m) => (
          <li key={m.slug} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="min-w-0 flex-1 font-semibold">{m.name}</span>
            {m.role === "primary" ? (
              <Chip tone="accent">Primary</Chip>
            ) : (
              <>
                <Chip>{m.role}</Chip>
                <RunButton action={setMarketRole.bind(null, { market: m.slug, role: "primary" })} label="Make primary" size="sm" variant="ghost" />
              </>
            )}
            <RunButton action={setMarketRole.bind(null, { market: m.slug, role: "remove" })} label="Remove" size="sm" variant="ghost" confirm={`Stop serving ${m.name}?`} />
          </li>
        ))}
        {mine.length === 0 && <li className="px-4 py-3 text-sm text-muted">No markets yet.</li>}
      </ul>
      <div className="mt-3 border-y border-line bg-surface py-4">
        <ActionForm action={addMarket} submitLabel="Add market" submitVariant="secondary" className="px-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Market" name="market" options={all.filter((m) => !have.has(m.slug)).map((m) => ({ value: m.slug, label: `${m.name}, ${m.state}` }))} placeholder="Pick a market" />
            <SelectField
              label="As"
              name="role"
              options={[
                { value: "secondary", label: "Secondary" },
                { value: "primary", label: "Primary" },
                { value: "travel", label: "Travel" },
              ]}
              defaultValue="secondary"
            />
          </div>
        </ActionForm>
      </div>
    </>
  );
}

export function ReminderRules({ settings }: { settings: Record<string, unknown> }) {
  const qh = Array.isArray(settings.quiet_hours) ? (settings.quiet_hours as string[]) : ["19:00", "07:00"];
  return (
    <>
      <SectionTitle>Reminders</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveNotificationRules} submitLabel="Save reminder rules" submitVariant="secondary" className="px-4">
          <div className="grid grid-cols-3 gap-3">
            <TextField label="Quiet from" name="quiet_from" type="time" defaultValue={qh[0] ?? "19:00"} />
            <TextField label="Quiet until" name="quiet_to" type="time" defaultValue={qh[1] ?? "07:00"} />
            <TextField label="Pushes / day" name="max_pushes_per_day" type="number" min={0} defaultValue={Number(settings.max_pushes_per_day ?? 3)} inputMode="numeric" />
          </div>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" name="weekend_reminders" value="1" defaultChecked={settings.weekend_reminders === true} className="size-5" />
            <span>Send reminders on weekends</span>
          </label>
        </ActionForm>
      </div>
    </>
  );
}

export function ScorecardTargets({ t }: { t: Targets }) {
  return (
    <>
      <SectionTitle>Scorecard targets</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveScorecardTargets} submitLabel="Save targets" submitVariant="secondary" className="px-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Meetings / month" name="meetings_month" type="number" min={0} inputMode="numeric" defaultValue={t.meetings_month} />
            <TextField label="Paperwork / month" name="paperwork_month" type="number" min={0} inputMode="numeric" defaultValue={t.paperwork_month} />
            <TextField label="In person / rep / week" name="in_person_rep_week" type="number" min={0} inputMode="numeric" defaultValue={t.in_person_rep_week} />
            <TextField label="First touches / month" name="first_touches_month" type="number" min={0} inputMode="numeric" defaultValue={t.first_touches_month} />
            <TextField label="Follow-up %" name="follow_up_pct" type="number" min={0} inputMode="numeric" defaultValue={t.follow_up_pct} />
          </div>
          <p className="text-sm text-muted">Blank = no goal line on the Team scorecard.</p>
        </ActionForm>
      </div>
    </>
  );
}

export function TargetingEditor({ tenantName, rows, known }: { tenantName: string; rows: { dimension: string; value: string; mode: string; weight: number | null; note: string | null }[]; known: string[] }) {
  return (
    <>
      <SectionTitle>Targeting — what {tenantName} pursues</SectionTitle>
      <p className="px-4 pb-2 text-sm text-muted">Include rows boost ranking by their weight (1.0 = neutral). Exclude rows push matching accounts off the queue with a visible reason.</p>
      <ul className="divide-y divide-line border-y border-line bg-surface">
        {rows.map((t) => (
          <li key={`${t.dimension}:${t.value}`} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {t.dimension === "account_type" && t.value in ACCOUNT_TYPES ? ACCOUNT_TYPES[t.value as keyof typeof ACCOUNT_TYPES] : t.value.replace(/_/g, " ")}
              </div>
              <div className="text-sm text-muted">
                {DIMENSIONS[t.dimension as keyof typeof DIMENSIONS] ?? t.dimension}
                {t.note && ` · ${t.note}`}
              </div>
            </div>
            {t.mode === "exclude" ? <Chip tone="bad">Exclude</Chip> : <Chip tone={Number(t.weight) >= 1 ? "good" : "warn"}>× {Number(t.weight).toFixed(2)}</Chip>}
            <ActionForm action={deleteTargeting} submitLabel="Remove" submitVariant="secondary" className="w-28 gap-0">
              <input type="hidden" name="dimension" value={t.dimension} />
              <input type="hidden" name="value" value={t.value} />
            </ActionForm>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-3 text-sm text-muted">No targeting yet — every account ranks on tier and portfolio alone.</li>}
      </ul>
      <div className="mt-3 border-y border-line bg-surface py-4">
        <ActionForm action={saveTargeting} submitLabel="Save targeting row" className="px-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Dimension" name="dimension" options={Object.entries(DIMENSIONS).map(([value, label]) => ({ value, label }))} defaultValue="service_line" />
            <label className="flex flex-col gap-1.5">
              <span className="label text-xs text-muted">Value</span>
              <input name="value" list="targeting-values" required className="w-full min-h-12 rounded-lg border-2 border-line bg-surface px-3 text-base" placeholder="repair" />
              <datalist id="targeting-values">
                {[...new Set(known)].map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Mode"
              name="mode"
              options={[
                { value: "include", label: "Include (weight)" },
                { value: "exclude", label: "Exclude" },
              ]}
              defaultValue="include"
            />
            <TextField label="Weight" name="weight" type="number" step="0.05" min={0} defaultValue={1} inputMode="decimal" />
          </div>
          <TextField label="Note" name="note" placeholder="Core offer · not a line we run" />
        </ActionForm>
      </div>
    </>
  );
}

export function TeamGoalForm({ goal }: { goal: TeamGoal | null }) {
  return (
    <>
      <SectionTitle>Team goal (monthly)</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveTeamGoal} submitLabel={goal ? "Update goal" : "Set goal"} className="px-4">
          <TextField label="Label" name="label" required defaultValue={goal?.label ?? "Inspections booked"} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Counts" name="event" options={Object.entries(GOAL_EVENTS).map(([value, label]) => ({ value, label }))} defaultValue={goal?.event ?? "inspection_booked"} />
            <TextField label="Target" name="target" type="number" min={1} required defaultValue={goal?.target ?? 20} inputMode="numeric" />
          </div>
        </ActionForm>
        {goal && (
          <ActionForm action={saveTeamGoal} submitLabel="Clear goal" submitVariant="secondary" className="mt-3 px-4">
            <input type="hidden" name="clear" value="1" />
          </ActionForm>
        )}
      </div>
    </>
  );
}

export function knownTargetingValues(marketSlugs: string[]): string[] {
  return [...Object.keys(SERVICE_LINES), ...Object.keys(ACCOUNT_TYPES), ...marketSlugs, "multifamily", "office", "industrial", "retail", "k12", "healthcare"];
}
