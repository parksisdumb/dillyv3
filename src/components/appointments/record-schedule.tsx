import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { safe } from "@/lib/server/safe";
import { loadRecordAppointments } from "@/lib/server/appointments";
import type { ScheduleTarget } from "@/lib/appointments/types";
import { ScheduleEntry } from "@/components/appointments/appt-card";

/** Server half of the record-page Schedule entry: loads what's booked on this record (degrades to just the button). */
export async function RecordSchedule({ c, target, label }: { c: Ctx; target: ScheduleTarget; label?: string }) {
  const ref = target.propertyId ? { propertyId: target.propertyId } : target.contactId ? { contactId: target.contactId } : { accountId: target.accountId };
  const appointments = await safe(() => loadRecordAppointments(c, ref), [], "record:appointments", { tenant: c.tenantId });
  return <ScheduleEntry target={target} appointments={appointments} label={label} />;
}
