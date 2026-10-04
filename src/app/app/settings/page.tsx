import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { saveProfile, saveTargeting, deleteTargeting, saveTeamGoal, createInvite, deleteInvite } from "@/lib/actions/settings";
import { signOut } from "@/lib/actions/auth";
import { ACCOUNT_TYPES, ROLES, SERVICE_LINES } from "@/lib/domain/vocab";
import { GOAL_EVENTS, parseTeamGoal } from "@/lib/domain/team-goal";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/fields";
import { Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { IconLogout } from "@/components/icons";
import { EmailConnectCard } from "@/components/settings/email-connect-card";
import { NotificationsSection } from "@/components/push/notifications-section";
import { DataSection } from "@/components/import/data-section";
import { getMembers } from "@/lib/server/members";

export const metadata: Metadata = { title: "Settings" };

const DIMENSIONS = { service_line: "Service line", account_type: "Account type", asset_class: "Asset class", market: "Market" } as const;

async function SettingsPageBody() {
  const c = await ctx();
  const { sb, s, tenantId } = c;
  const ownerish = s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin;
  const [profile, targeting, tenantRow, invites, markets] = await Promise.all([
    sb.from("profile").select("full_name,phone,email").eq("id", s.userId).single(),
    sb.from("tenant_targeting").select("dimension,value,mode,weight,note").eq("tenant_id", tenantId).order("dimension").order("value"),
    sb.from("tenant").select("settings").eq("id", tenantId).single(),
    s.isManager ? sb.from("invite").select("id,email,role,full_name,claimed_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    sb.from("tenant_market").select("market_id").eq("tenant_id", tenantId),
  ]);
  const marketIds = (markets.data ?? []).map((m) => m.market_id);
  const { data: marketRows } = marketIds.length ? await sb.from("market").select("slug,name").in("id", marketIds) : { data: [] };
  const goal = parseTeamGoal(tenantRow.data?.settings);
  const known = [
    ...Object.keys(SERVICE_LINES),
    ...Object.keys(ACCOUNT_TYPES),
    ...(marketRows ?? []).map((m) => m.slug),
    "multifamily",
    "office",
    "industrial",
    "retail",
    "k12",
    "healthcare",
  ];
  const inviteRoles = ownerish ? ROLES : ROLES.filter((r) => r !== "owner" && r !== "admin");

  return (
    <div>
      <PageHeader title="Settings" sub={s.tenant.name} />

      <SectionTitle>Profile</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveProfile} submitLabel="Save profile" submitVariant="secondary" className="px-4">
          <TextField label="Name" name="full_name" required defaultValue={profile.data?.full_name} autoComplete="name" />
          <TextField label="Mobile" name="phone" type="tel" inputMode="tel" defaultValue={profile.data?.phone} autoComplete="tel" />
          <p className="text-sm text-muted">Signed in as {profile.data?.email ?? s.email}</p>
        </ActionForm>
      </div>

      {s.isManager && (
        <>
          <SectionTitle>Targeting — what {s.tenant.name} pursues</SectionTitle>
          <p className="px-4 pb-2 text-sm text-muted">Include rows boost ranking by their weight (1.0 = neutral). Exclude rows push matching accounts off the queue with a visible reason.</p>
          <ul className="divide-y divide-line border-y border-line bg-surface">
            {(targeting.data ?? []).map((t) => (
              <li key={`${t.dimension}:${t.value}`} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.value.replace(/_/g, " ")}</div>
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
            {(targeting.data ?? []).length === 0 && <li className="px-4 py-3 text-sm text-muted">No targeting yet — every account ranks on tier and portfolio alone.</li>}
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
      )}

      {ownerish && (
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
      )}

      {s.isManager && (
        <>
          <SectionTitle>Invites</SectionTitle>
          <ul className="divide-y divide-line border-y border-line bg-surface">
            {(invites.data ?? []).map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{i.full_name ?? i.email}</div>
                  <div className="truncate text-sm text-muted">
                    {i.email} · <span className="label">{i.role}</span>
                  </div>
                </div>
                {i.claimed_at ? (
                  <Chip tone="good">Joined</Chip>
                ) : (
                  <ActionForm action={deleteInvite} submitLabel="Cancel" submitVariant="secondary" className="w-28 gap-0">
                    <input type="hidden" name="id" value={i.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 border-y border-line bg-surface py-4">
            <ActionForm action={createInvite} submitLabel="Send invite" className="px-4">
              <TextField label="Email" name="email" type="email" required inputMode="email" />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Name" name="full_name" />
                <SelectField label="Role" name="role" options={inviteRoles.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))} defaultValue="rep" />
              </div>
              <p className="text-sm text-muted">They sign in with this email (password or emailed link) and land in {s.tenant.name}.</p>
            </ActionForm>
          </div>
        </>
      )}

      {s.isManager && <DataSection ownerish={ownerish} today={c.today} members={ownerish ? await getMembers(c) : []} />}

      <EmailConnectCard />
      <NotificationsSection />

      <form action={signOut} className="px-4 py-6">
        <button type="submit" className={btn("secondary", "lg", "w-full")}>
          <IconLogout size={20} /> Sign out
        </button>
      </form>
    </div>
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default function SettingsPage() {
  return pageBody(() => SettingsPageBody());
}
