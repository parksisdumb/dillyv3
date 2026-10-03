import { saveOpportunity, markLost, markWon } from "@/lib/actions/records";
import { OPEN_STAGES, SERVICE_LINES, STAGES } from "@/lib/domain/vocab";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField, opts } from "@/components/ui/fields";
import type { Member } from "@/lib/server/members";

type OppValues = {
  id?: string;
  account_id?: string | null;
  property_id?: string | null;
  primary_contact_id?: string | null;
  name?: string | null;
  service_line?: string | null;
  stage?: string | null;
  value_estimate?: number | null;
  gross_profit_estimate?: number | null;
  next_step?: string | null;
  next_step_due?: string | null;
  owner_user_id?: string | null;
};

type Opt = { id: string; label: string };

export function OpportunityForm({
  o,
  accounts,
  properties,
  contacts,
  members,
  today,
}: {
  o: OppValues;
  accounts: Opt[];
  properties: Opt[];
  contacts: Opt[];
  members: Member[];
  today: string;
}) {
  return (
    <ActionForm action={saveOpportunity} submitLabel={o.id ? "Save" : "Create opportunity"} stickySubmit className="px-4 pt-2">
      {o.id && <input type="hidden" name="id" value={o.id} />}
      <TextField label="Job name" name="name" required defaultValue={o.name} placeholder="Bldg 3 TPO repair" />
      <SelectField label="Account" name="account_id" options={accounts.map((a) => ({ value: a.id, label: a.label }))} defaultValue={o.account_id} placeholder="—" />
      {properties.length > 0 && (
        <SelectField label="Property" name="property_id" options={properties.map((a) => ({ value: a.id, label: a.label }))} defaultValue={o.property_id} placeholder="—" />
      )}
      {contacts.length > 0 && (
        <SelectField label="Main contact" name="primary_contact_id" options={contacts.map((a) => ({ value: a.id, label: a.label }))} defaultValue={o.primary_contact_id} placeholder="—" />
      )}
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Service" name="service_line" options={opts(SERVICE_LINES)} defaultValue={o.service_line ?? "repair"} />
        <SelectField
          label="Stage"
          name="stage"
          options={(o.stage === "won" ? [...OPEN_STAGES, "won" as const] : OPEN_STAGES).map((s) => ({ value: s, label: STAGES[s] }))}
          defaultValue={o.stage ?? "lead"}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Value $" name="value_estimate" type="number" inputMode="decimal" min={0} step="any" defaultValue={o.value_estimate} />
        <TextField label="Gross profit $" name="gross_profit_estimate" type="number" inputMode="decimal" min={0} step="any" defaultValue={o.gross_profit_estimate} />
      </div>
      <fieldset className="flex flex-col gap-3 rounded-lg border-2 border-accent p-3">
        <legend className="label px-1 text-xs text-accent">Next step — required while open</legend>
        <TextField label="Next step" name="next_step" defaultValue={o.next_step} placeholder="Walk the roof with Dave" />
        <TextField label="Due" name="next_step_due" type="date" min={today} defaultValue={o.next_step_due} />
      </fieldset>
      <SelectField label="Owner" name="owner_user_id" options={members.map((m) => ({ value: m.user_id, label: m.name }))} defaultValue={o.owner_user_id} placeholder="Me" />
    </ActionForm>
  );
}

export function WonForm({ id }: { id: string }) {
  return (
    <ActionForm action={markWon} submitLabel="Mark won" submitVariant="success" confirm="Mark this job won?">
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}

export function LostForm({ id }: { id: string }) {
  return (
    <ActionForm action={markLost} submitLabel="Mark lost" submitVariant="danger">
      <input type="hidden" name="id" value={id} />
      <TextField label="Why was it lost?" name="lost_reason" required placeholder="Went with low bid · budget pushed to next year" />
    </ActionForm>
  );
}
