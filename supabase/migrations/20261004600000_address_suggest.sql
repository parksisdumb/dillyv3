-- Dilly — address suggestions while typing. Additive only.
--
--   * property.geocode_source may now be 'google' or 'photon': the pin came from the address the rep picked in the
--     autocomplete (Google Places API (New) with GOOGLE_MAPS_API_KEY, else Photon/OSM), saved with the property, so
--     the building doesn't wait for the Census batch geocoder.

alter table public.property drop constraint if exists property_geocode_source_chk;
alter table public.property add constraint property_geocode_source_chk
  check (geocode_source is null or geocode_source in ('census','census_nomatch','census_error','manual','import','device','google','photon'));
