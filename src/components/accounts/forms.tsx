// Record forms. Server components that render fields into the client ActionForm.
import { saveAccount } from "@/lib/actions/accounts";
import { saveContact, saveProperty } from "@/lib/actions/records";
import { ACCOUNT_TYPES, PERSONA_ROLES } from "@/lib/domain/vocab";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextArea, TextField, opts } from "@/components/ui/fields";
import type { Member } from "@/lib/server/members";
import { SearchPicker } from "@/components/ui/search-picker";
import { quickCreateAccount, searchAccountOptions, type PickOption } from "@/lib/actions/book";

type AccountValues = {
  id?: string;
  name?: string | null;
  account_type?: string | null;
  icp_tier?: number | null;
  owner_user_id?: string | null;
  phone?: string | null;
  website?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
};

export function AccountForm({ a = {}, members, me }: { a?: AccountValues; members: Member[]; me: string }) {
  return (
    <ActionForm action={saveAccount} submitLabel={a.id ? "Save account" : "Create account"} stickySubmit className="px-4 pt-2">
      {a.id && <input type="hidden" name="id" value={a.id} />}
      <TextField label="Company name" name="name" required defaultValue={a.name} autoComplete="organization" />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Type" name="account_type" options={opts(ACCOUNT_TYPES)} defaultValue={a.account_type ?? "property_mgmt"} />
        <SelectField
          label="Priority"
          name="icp_tier"
          options={[1, 2, 3, 4].map((t) => ({ value: String(t), label: `P${t}` }))}
          defaultValue={a.icp_tier ?? 3}
        />
      </div>
      <SelectField label="Owner" name="owner_user_id" options={members.map((m) => ({ value: m.user_id, label: m.name }))} defaultValue={a.owner_user_id ?? me} placeholder="Unassigned" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Main phone" name="phone" type="tel" inputMode="tel" defaultValue={a.phone} />
        <TextField label="Website" name="website" defaultValue={a.website} inputMode="url" />
      </div>
      <TextField label="Office address" name="address1" defaultValue={a.address1} autoComplete="street-address" />
      <div className="grid grid-cols-[1fr_5rem_6rem] gap-3">
        <TextField label="City" name="city" defaultValue={a.city} />
        <TextField label="State" name="state" defaultValue={a.state} />
        <TextField label="Zip" name="zip" defaultValue={a.zip} inputMode="numeric" />
      </div>
      <TextArea label="Notes" name="notes" defaultValue={a.notes} />
      {!a.id && (
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" name="force" value="1" className="size-5" /> Create anyway if the name already exists
        </label>
      )}
    </ActionForm>
  );
}

type PropertyValues = {
  id?: string;
  account_id?: string | null;
  name?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  asset_class?: string | null;
  roof_system?: string | null;
  roof_area_sf?: number | null;
  roof_install_year?: number | null;
  warranty_expires_on?: string | null;
  building_count?: number | null;
  notes?: string | null;
};

const ROOF_SYSTEMS = ["TPO", "EPDM", "PVC", "Mod-bit", "BUR", "Metal", "Shingle", "Coating", "Other"];
const ASSET_CLASSES = ["Multifamily", "Office", "Industrial", "Retail", "K-12", "Higher ed", "Healthcare", "Hospitality", "Government", "Religious", "Mixed use", "Other"];

/** `account` given = show a searchable account picker (standalone create / edit); omitted = fixed to p.account_id. */
export function PropertyForm({ p, account }: { p: PropertyValues; account?: PickOption | null }) {
  return (
    <ActionForm action={saveProperty} submitLabel={p.id ? "Save property" : "Add property"} stickySubmit className="px-4 pt-2">
      {p.id && <input type="hidden" name="id" value={p.id} />}
      {account !== undefined ? (
        <SearchPicker
          name="account_id"
          label="Account"
          search={searchAccountOptions}
          create={quickCreateAccount}
          initial={account}
          placeholder="Owner or manager"
          hint="Optional — link the owner or property manager so it shows up in their portfolio."
        />
      ) : (
        p.account_id && <input type="hidden" name="account_id" value={p.account_id} />
      )}
      <TextField label="Property name" name="name" defaultValue={p.name} placeholder="Riverside Apartments" />
      <TextField label="Address" name="address1" defaultValue={p.address1} autoComplete="street-address" />
      <div className="grid grid-cols-[1fr_5rem_6rem] gap-3">
        <TextField label="City" name="city" defaultValue={p.city} />
        <TextField label="State" name="state" defaultValue={p.state} />
        <TextField label="Zip" name="zip" defaultValue={p.zip} inputMode="numeric" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Asset class" name="asset_class" options={ASSET_CLASSES.map((x) => ({ value: x.toLowerCase(), label: x }))} defaultValue={p.asset_class} placeholder="—" />
        <SelectField label="Roof system" name="roof_system" options={ROOF_SYSTEMS.map((x) => ({ value: x, label: x }))} defaultValue={p.roof_system} placeholder="Unknown" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Roof sf" name="roof_area_sf" type="number" inputMode="numeric" min={0} defaultValue={p.roof_area_sf} />
        <TextField label="Installed" name="roof_install_year" type="number" inputMode="numeric" min={1900} defaultValue={p.roof_install_year} />
        <TextField label="Buildings" name="building_count" type="number" inputMode="numeric" min={0} defaultValue={p.building_count} />
      </div>
      <TextField label="Warranty expires" name="warranty_expires_on" type="date" defaultValue={p.warranty_expires_on} />
      <TextArea label="Notes" name="notes" defaultValue={p.notes} placeholder="Ponding on the west side, 2009 TPO" />
      {!p.id && (
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" name="force" value="1" className="size-5" /> Create anyway if that address exists
        </label>
      )}
    </ActionForm>
  );
}

type ContactValues = {
  id: string;
  full_name: string | null;
  title: string | null;
  persona_role: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  linkedin_url: string | null;
  account_id: string | null;
  notes: string | null;
  do_not_contact: boolean;
};

export function ContactEditForm({ c, account }: { c: ContactValues; account: PickOption | null }) {
  return (
    <ActionForm action={saveContact} submitLabel="Save contact" className="px-4 pt-2">
      <input type="hidden" name="id" value={c.id} />
      <TextField label="Name" name="full_name" required defaultValue={c.full_name} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Title" name="title" defaultValue={c.title} />
        <SelectField label="Role" name="persona_role" options={opts(PERSONA_ROLES)} defaultValue={c.persona_role} />
      </div>
      <SearchPicker name="account_id" label="Account" search={searchAccountOptions} create={quickCreateAccount} initial={account} placeholder="Company they work for" hint="Clear it to unlink the account." />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Mobile" name="mobile" type="tel" inputMode="tel" defaultValue={c.mobile} />
        <TextField label="Office phone" name="phone" type="tel" inputMode="tel" defaultValue={c.phone} />
      </div>
      <TextField label="Email" name="email" type="email" inputMode="email" defaultValue={c.email} />
      <TextField label="LinkedIn" name="linkedin_url" defaultValue={c.linkedin_url} inputMode="url" />
      <TextArea label="Notes" name="notes" defaultValue={c.notes} />
      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" name="do_not_contact" defaultChecked={c.do_not_contact} className="size-5" /> Do not contact
      </label>
    </ActionForm>
  );
}
