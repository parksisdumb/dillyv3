-- Card Collector / field capture: award points when a rep creates a contact from the field.
create or replace function app.on_contact_insert() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.source = 'field' and new.created_by is not null and not new.is_test then
    perform app.award(new.tenant_id, new.created_by, 'field_contact_created', null, null, null, new.account_id, new.created_at);
  end if;
  return new;
end $$;
create trigger contact_after_insert after insert on public.contact for each row execute function app.on_contact_insert();
