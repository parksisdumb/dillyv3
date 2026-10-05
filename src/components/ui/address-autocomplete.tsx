"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn, input, labelText } from "@/components/ui/styles";
import { createSuggester, fetchDetails, newSessionToken } from "@/lib/geo/suggest/client";
import type { AddressSuggestion, LatLngBias } from "@/lib/geo/suggest/types";

type Values = { address1?: string | null; city?: string | null; state?: string | null; zip?: string | null };
type Coords = { lat: number; lng: number; source: "google" | "photon" };

/**
 * Street address with suggestions as you type, plus City / State / Zip (same names as the plain fields:
 * address1, city, state, zip). ARIA 1.2 combobox: ↑/↓ move, Enter picks, Escape closes, tap picks.
 * Picking fills all four fields and — with `withCoords` — hidden lat / lng / geocode_source, so the building gets its
 * pin at once instead of waiting for the Census batch geocoder. Typing over a pick drops the pin again.
 * The last option is always "Use what I typed", so a rep is never stuck on a bad suggestion. Offline or when the
 * service is down it is just a text input. The list overlays the form (absolute), so nothing below it moves.
 */
export function AddressAutocomplete({
  label = "Address",
  defaults = {},
  withCoords = false,
  placeholder,
}: {
  label?: string;
  defaults?: Values;
  withCoords?: boolean;
  placeholder?: string;
}) {
  const uid = useId();
  const inputId = `${uid}-address1`;
  const listId = `${uid}-list`;
  const [value, setValue] = useState(defaults.address1 ?? "");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const session = useRef<string | null>(null);
  const near = useRef<LatLngBias | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const suggester = useMemo(
    () =>
      createSuggester({
        online: () => typeof navigator === "undefined" || navigator.onLine !== false,
        session: () => (session.current ??= newSessionToken()),
        near: () => near.current,
      }),
    [],
  );
  useEffect(() => () => suggester.cancel(), [suggester]);

  // Bias to where the rep is — only if they already allowed location (Go); never prompts from a form.
  const locate = useCallback(() => {
    if (near.current || typeof navigator === "undefined" || !navigator.permissions || !navigator.geolocation) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (p.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (pos) => (near.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => undefined,
          { maximumAge: 10 * 60_000, timeout: 3_000, enableHighAccuracy: false },
        );
      })
      .catch(() => undefined);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  const lookup = (q: string) => {
    suggester.request(q).then((r) => {
      if (r.ok) {
        setItems(r.suggestions);
        setOpen(r.suggestions.length > 0);
        setActive(-1);
        setStatus(r.suggestions.length ? `${r.suggestions.length} suggestion${r.suggestions.length === 1 ? "" : "s"}. Use up and down arrows to choose.` : "");
      } else if (r.reason !== "aborted") {
        setItems([]);
        close();
      }
    });
  };

  const fill = (s: AddressSuggestion) => {
    if (s.address1) setValue(s.address1);
    if (s.city && cityRef.current) cityRef.current.value = s.city;
    if (s.state && stateRef.current) stateRef.current.value = s.state;
    if (s.zip && zipRef.current) zipRef.current.value = s.zip;
    setCoords(withCoords && s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng, source: s.provider } : null);
  };

  const pick = async (i: number) => {
    suggester.cancel();
    close();
    if (i >= items.length) {
      // "Use what I typed": keep the text, no pin (the Census geocoder takes over after saving).
      setItems([]);
      setCoords(null);
      setStatus("Keeping what you typed.");
      return;
    }
    const s = items[i];
    setItems([]);
    if (s.needsDetails) {
      if (s.address1) setValue(s.address1);
      setBusy(true);
      const d = await fetchDetails(s.id, session.current);
      setBusy(false);
      if (d) fill(d);
    } else fill(s);
    session.current = null; // the pick ends this billing session
    setStatus(`Filled ${s.label}.`);
  };

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const count = items.length + 1; // + "Use what I typed"
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!open) {
        if (items.length) setOpen(true);
        return;
      }
      e.preventDefault();
      setActive((a) => (a + 1) % count);
    } else if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      setActive((a) => (a <= 0 ? count - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0) {
        e.preventDefault(); // pick, don't submit the form
        void pick(active);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      }
    }
  };

  const dropPin = () => setCoords(null);
  const expanded = open && items.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className={labelText}>
          {label}
        </label>
        <div className="relative">
          <input
            id={inputId}
            className={input}
            name="address1"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
            aria-busy={busy || undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder={placeholder}
            value={value}
            onFocus={locate}
            onChange={(e) => {
              setValue(e.target.value);
              dropPin();
              lookup(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              suggester.cancel();
              close();
            }}
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            hidden={!expanded}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(24rem,55vh)] divide-y divide-line overflow-y-auto overscroll-contain rounded-lg border-2 border-ink bg-surface shadow-lg"
          >
            {expanded &&
              [...items, null].map((s, i) => (
                <li
                  key={s?.id ?? "__typed"}
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  // Keep focus in the input so the tap isn't eaten by a blur-close.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pick(i)}
                  className={cn(
                    "flex min-h-12 cursor-pointer flex-col justify-center px-3 py-1 text-left",
                    i === active ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  {s ? (
                    <span className="truncate font-semibold">{s.label}</span>
                  ) : (
                    <>
                      <span className="font-semibold text-accent">Use what I typed</span>
                      <span className="truncate text-xs text-muted">{value}</span>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </div>
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {busy ? "Filling in the address…" : status}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_5rem_6rem] gap-3">
        <PlainField label="City" name="city" inputRef={cityRef} defaultValue={defaults.city} onEdit={dropPin} />
        <PlainField label="State" name="state" inputRef={stateRef} defaultValue={defaults.state} onEdit={dropPin} />
        <PlainField label="Zip" name="zip" inputRef={zipRef} defaultValue={defaults.zip} onEdit={dropPin} inputMode="numeric" />
      </div>
      {withCoords && coords && (
        <>
          <input type="hidden" name="lat" value={coords.lat} />
          <input type="hidden" name="lng" value={coords.lng} />
          <input type="hidden" name="geocode_source" value={coords.source} />
        </>
      )}
    </div>
  );
}

function PlainField({
  label,
  name,
  inputRef,
  defaultValue,
  onEdit,
  inputMode,
}: {
  label: string;
  name: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  defaultValue?: string | null;
  onEdit: () => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelText}>{label}</span>
      <input ref={inputRef} className={input} type="text" name={name} defaultValue={defaultValue ?? undefined} inputMode={inputMode} onChange={onEdit} />
    </label>
  );
}
