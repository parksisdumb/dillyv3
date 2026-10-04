import { ctx } from "@/lib/server/ctx";
import { settingsFromTenant } from "@/agents/rep-daily-brief/rank";
import { vapidPublicKey } from "@/lib/push/config";
import { clock12, deviceLabel } from "@/lib/push/device";
import { removePushDevice } from "@/lib/push/actions";
import { ActionForm } from "@/components/ui/action-form";
import { Chip, SectionTitle } from "@/components/ui/bits";
import { shortDate } from "@/lib/format";
import { PushControls } from "./push-controls";

/** Settings → Notifications: this phone on/off, my devices, quiet hours, test. Loads its own data. */
export async function NotificationsSection() {
  const { sb, s, tenantId } = await ctx();
  const [devices, tenant] = await Promise.all([
    sb
      .from("push_subscription")
      .select("id,endpoint,user_agent,created_at,last_success_at,failure_count,disabled_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", s.userId)
      .order("created_at", { ascending: false }),
    sb.from("tenant").select("settings").eq("id", tenantId).single(),
  ]);
  const st = settingsFromTenant(s.tenant.timezone, tenant.data?.settings);
  const rows = devices.data ?? [];
  const active = rows.filter((d) => !d.disabled_at);

  return (
    <section id="notifications" aria-labelledby="notifications-title">
      <SectionTitle>
        <span id="notifications-title">Notifications</span>
      </SectionTitle>
      <div className="border-y border-line bg-surface px-4 py-4">
        <PushControls
          vapidPublicKey={vapidPublicKey()}
          activeDevices={active.length}
          // Only the tail of each endpoint goes to the browser — enough to say "This phone".
          endpointTails={active.map((d) => d.endpoint.slice(-24))}
        />
      </div>

      <h3 className="label px-4 pb-1 pt-4 text-xs text-muted">Quiet hours</h3>
      <div className="border-y border-line bg-surface px-4 py-3 text-sm">
        <p>
          Reminders go out {clock12(st.pushWindowStart)}–{clock12(st.pushWindowEnd)}
          {st.weekendReminders ? ", every day" : ", weekdays only"}. Up to {st.maxPushesPerDay} a day. Nothing outside those hours.
        </p>
        <p className="mt-1 text-muted">Set by {s.tenant.name} · {st.timeZone.replace(/_/g, " ")}</p>
      </div>

      <h3 className="label px-4 pb-1 pt-4 text-xs text-muted">My devices</h3>
      <ul className="divide-y divide-line border-y border-line bg-surface" aria-label="My devices">
        {rows.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{deviceLabel(d.user_agent)}</div>
              <div className="truncate text-sm text-muted">
                Added {shortDate(d.created_at.slice(0, 10))}
                {d.last_success_at ? ` · last reminder ${shortDate(d.last_success_at.slice(0, 10))}` : ""}
              </div>
            </div>
            {d.disabled_at ? <Chip tone="bad">Stopped</Chip> : d.failure_count > 0 ? <Chip tone="warn">Not answering</Chip> : <Chip tone="good">On</Chip>}
            <ActionForm action={removePushDevice} submitLabel="Remove" submitVariant="secondary" submitSize="md" className="w-28 gap-0">
              <input type="hidden" name="id" value={d.id} />
            </ActionForm>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-3 text-sm text-muted">No devices yet. Turn on reminders above on each phone you use.</li>}
      </ul>
    </section>
  );
}
