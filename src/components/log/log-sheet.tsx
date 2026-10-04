"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadLogContext } from "@/lib/actions/log";
import { isQueued, useLogTouch } from "@/components/log/use-log-touch";
import { PhotoPicker, type PendingPhoto } from "@/components/photos/photo-picker";
import { isNetworkError } from "@/lib/offline/net";
import type { ContactOption, LogContextData, LogTarget } from "@/lib/actions/log-types";
import { CHANNELS, OUTCOMES, PERSONA_ROLES, PRIMARY_CHANNELS, QUICK_OUTCOMES, type Channel, type Outcome, type PersonaRole } from "@/lib/domain/vocab";
import { DEFAULT_POINTS, previewPoints, sitewalkPoints } from "@/lib/domain/points";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { btn, cn, input, labelText } from "@/components/ui/styles";
import { ContactPicker } from "@/components/log/contact-picker";
import { IconBuilding, IconChevronDown, IconUser } from "@/components/icons";

const MORE_CHANNELS = (Object.keys(CHANNELS) as Channel[]).filter((c) => !PRIMARY_CHANNELS.includes(c));

// Contexts loaded this session, so the sheet still opens in a dead zone for a place the rep already opened it.
const contextCache = new Map<string, LogContextData>();
const cacheKey = (t: LogTarget) => [t.accountId, t.contactId, t.propertyId, t.opportunityId].map((x) => x ?? "").join("|");

/** No signal and never loaded: enough to log on the record the rep is looking at. Names come back with signal. */
function offlineContext(t: LogTarget): LogContextData | null {
  if (!t.accountId && !t.contactId && !t.propertyId) return null;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    account: t.accountId ? { id: t.accountId, name: "This account" } : null,
    contact: t.contactId ? { id: t.contactId, name: "This contact", title: null, persona_role: "unknown", account_id: t.accountId ?? null } : null,
    contacts: [],
    properties: t.propertyId ? [{ id: t.propertyId, label: "This building" }] : [],
    opportunities: [],
    points: DEFAULT_POINTS,
    today,
  };
}

/**
 * The 3-tap log: (1) contact, pre-selected from context  (2) channel  (3) outcome — the outcome tap logs.
 * Details (notes, who I met, follow-up date, skip, property/opportunity) are optional and collapsed.
 */
export function LogSheet({
  open,
  target,
  onClose,
  initial,
}: {
  open: boolean;
  target: LogTarget;
  onClose: () => void;
  /** Pre-loaded state (dev preview): skips the server load and opens at a given step. */
  initial?: { data: LogContextData; contact: ContactOption | null; picking?: boolean; channel?: Channel | null; details?: boolean; photos?: PendingPhoto[]; offline?: boolean };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<LogContextData | null>(initial?.data ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactOption | null>(initial?.contact ?? null);
  const [picking, setPicking] = useState(initial?.picking ?? false);
  const [channel, setChannel] = useState<Channel | null>(initial?.channel ?? null);
  const [moreChannels, setMoreChannels] = useState(false);
  const [details, setDetails] = useState(initial?.details ?? false);
  const [notes, setNotes] = useState("");
  const [metRole, setMetRole] = useState<PersonaRole | "">("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [skip, setSkip] = useState(false);
  const [propertyId, setPropertyId] = useState(target.propertyId ?? "");
  const [opportunityId, setOpportunityId] = useState(target.opportunityId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>(initial?.photos ?? []);
  const [offline, setOffline] = useState(initial?.offline ?? false);
  const [pending, start] = useTransition();
  const logTouch = useLogTouch(); // idempotent + never throws on lost signal

  const apply = (t: LogTarget, d: LogContextData, preferContact?: ContactOption | null) => {
    setData(d);
    setLoadError(null);
    // On an account, pre-pick its most recent person. With no context the list is "recent people" across
    // accounts — make the rep choose rather than guess.
    const c = preferContact ?? d.contact ?? (t.contactId || !d.account ? null : d.contacts[0] ?? null);
    setContact(c);
    setPicking(!d.account && !c);
  };
  const load = (t: LogTarget, preferContact?: ContactOption | null) =>
    loadLogContext(t)
      .then((d) => {
        contextCache.set(cacheKey(t), d);
        setOffline(false);
        apply(t, d, preferContact);
      })
      .catch((e) => {
        // Dead zone: use what this session already knows, or a bare context for the record on screen.
        const fallback = isNetworkError(e) ? contextCache.get(cacheKey(t)) ?? offlineContext(t) : null;
        if (fallback) {
          setOffline(true);
          apply(t, fallback, preferContact);
        } else setLoadError("Couldn't load. Check signal and try again.");
      });

  useEffect(() => {
    if (!open || initial) return;
    void load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open (the provider remounts with a new key)
  }, [open]);

  const account = data?.account ?? null;
  const canLog = !!(contact || account);

  const pickContact = (c: ContactOption | null, accountId?: string | null) => {
    setPicking(false);
    setError(null);
    const current = account?.id ?? null;
    const reload = c ? (c.account_id ?? null) !== current : !!accountId && accountId !== current;
    if (reload) {
      // Different account (or a person with no account): reload buildings/opportunities for the new context.
      setData(null);
      setPropertyId("");
      setOpportunityId("");
      void load(c ? { contactId: c.id } : { accountId }, c);
    } else {
      setContact(c);
    }
  };

  const submit = (outcome: Outcome) => {
    if (!channel || !canLog) return;
    setError(null);
    start(async () => {
      const who = contact?.name && contact.name !== "This contact" ? contact.name : account?.name && account.name !== "This account" ? account.name : null;
      const r = await logTouch(
        {
          accountId: account?.id ?? null,
          contactId: contact?.id ?? null,
          propertyId: propertyId || null,
          opportunityId: opportunityId || null,
          channel,
          outcome,
          notes: notes || null,
          metRole: metRole || null,
          followUpOn: followUpOn || null,
          skipFollowUp: skip,
        },
        {
          photos,
          label: [CHANNELS[channel].label, OUTCOMES[outcome].label, who].filter(Boolean).join(" · "),
          href: contact ? `/app/contacts/${contact.id}` : account ? `/app/accounts/${account.id}` : propertyId ? `/app/properties/${propertyId}` : null,
        },
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.toast, isQueued(r) ? "neutral" : "good");
      onClose();
      // Queued: no refresh (a server round-trip with no signal would bounce to the offline page). It refreshes on send.
      if (!isQueued(r)) router.refresh();
    });
  };

  const title = account ? account.name : "Log a touch";

  return (
    <Sheet open={open} onClose={onClose} title={<span className="block truncate">{title}</span>} labelledBy="log-sheet-title">
      {loadError && <p className="m-4 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">{loadError}</p>}
      {!data && !loadError && <p className="label p-6 text-center text-sm text-muted">Loading…</p>}

      {data && (
        <div className="flex flex-col gap-5 px-4 pt-4">
          {offline && (
            <p className="flex items-center gap-2 rounded-lg border-2 border-warning bg-warning/10 px-3 py-2 text-sm" role="status">
              No signal — this log will be saved on your phone and sent when you have bars.
            </p>
          )}
          {/* Step 1 — who */}
          <section aria-label="Who">
            <div className={cn(labelText, "mb-2")}>1 · Who</div>
            {picking ? (
              <ContactPicker
                accountId={account?.id ?? null}
                contacts={data.contacts}
                allowAccountLevel={!!account}
                onPick={pickContact}
                onCancel={contact || account ? () => setPicking(false) : undefined}
              />
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex min-h-14 w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 text-left"
              >
                {contact ? <IconUser size={20} /> : <IconBuilding size={20} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{contact ? contact.name : `${account?.name ?? "Account"} (no contact)`}</div>
                  <div className="truncate text-sm text-muted">
                    {contact
                      ? [contact.title, PERSONA_ROLES[contact.persona_role as PersonaRole]].filter((x) => x && x !== "Unknown").join(" · ") || "Contact"
                      : "Logging on the account"}
                  </div>
                </div>
                <span className="label text-xs text-accent">Change</span>
              </button>
            )}
          </section>

          {/* Step 2 — how */}
          {!picking && canLog && (
            <section aria-label="How">
              <div className={cn(labelText, "mb-2")}>2 · How</div>
              {channel ? (
                <button
                  type="button"
                  onClick={() => setChannel(null)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg border-2 border-ink bg-ink px-3 text-left text-ground"
                  aria-label={`${CHANNELS[channel].label} — change`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-base font-semibold">{CHANNELS[channel].label}</span>
                    {CHANNELS[channel].inPerson && <span className="label block text-xs text-ground/70">In person</span>}
                  </span>
                  <span className="label text-xs text-accent">Change</span>
                </button>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {[...PRIMARY_CHANNELS, ...(moreChannels ? MORE_CHANNELS : [])].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setChannel(c)}
                        className="flex min-h-14 flex-col items-start justify-center rounded-lg border-2 border-line bg-surface px-3 text-left text-ink hover:border-ink"
                      >
                        <span className="font-display text-base font-semibold leading-tight">{CHANNELS[c].label}</span>
                        {CHANNELS[c].inPerson && <span className="label text-xs text-muted">In person</span>}
                      </button>
                    ))}
                  </div>
                  {!moreChannels && (
                    <button type="button" onClick={() => setMoreChannels(true)} className={btn("ghost", "sm", "mt-1 w-full text-muted")}>
                      More ways
                    </button>
                  )}
                </>
              )}
            </section>
          )}

          {/* Optional details */}
          {!picking && canLog && channel && (
            <section>
              <button
                type="button"
                aria-expanded={details}
                onClick={() => setDetails((d) => !d)}
                className="flex min-h-12 w-full items-center gap-2 text-left text-sm text-muted"
              >
                <IconChevronDown size={18} className={cn("motion-safe:transition-transform", details && "rotate-180")} />
                <span className="label">Notes, who I met, follow-up, photos</span>
                {(notes || metRole || followUpOn || skip || propertyId || opportunityId || photos.length > 0) && <span className="size-2 rounded-full bg-accent" aria-label="details set" />}
              </button>
              {details && (
                <div className="flex flex-col gap-3 pb-1">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelText}>Notes</span>
                    <textarea className={cn(input, "py-2")} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Roof out of warranty, leaks in bldg 3" />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className={labelText}>Photos</span>
                    <PhotoPicker
                      photos={photos}
                      onChange={setPhotos}
                      hint={channel === "roof_walk" || channel === "inspection" ? `Photos from the roof earn +${data.points.site_walk_completed ?? 12}.` : undefined}
                    />
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className={labelText}>Who I met</span>
                    <select className={input} value={metRole} onChange={(e) => setMetRole(e.target.value as PersonaRole | "")}>
                      <option value="">—</option>
                      {Object.entries(PERSONA_ROLES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className={labelText}>Follow up on</span>
                      <input className={input} type="date" value={followUpOn} min={data.today} disabled={skip} onChange={(e) => setFollowUpOn(e.target.value)} />
                    </label>
                    <label className="flex min-h-12 items-center gap-2 self-end">
                      <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
                      <span className="text-sm">No follow-up</span>
                    </label>
                  </div>
                  {data.properties.length > 0 && (
                    <label className="flex flex-col gap-1.5">
                      <span className={labelText}>Property</span>
                      <select className={input} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                        <option value="">—</option>
                        {data.properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {data.opportunities.length > 0 && (
                    <label className="flex flex-col gap-1.5">
                      <span className={labelText}>Opportunity</span>
                      <select className={input} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
                        <option value="">—</option>
                        {data.opportunities.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Step 3 — what happened (tap logs) */}
          {!picking && canLog && channel && (
            <section aria-label="What happened">
              <div className={cn(labelText, "mb-2")}>3 · What happened — tap to log</div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_OUTCOMES[channel].map((o) => {
                  const pts = previewPoints(channel, o, metRole || null, data.points) + sitewalkPoints(channel, o, photos.length, data.points);
                  const tone = OUTCOMES[o].tone;
                  return (
                    <button
                      key={o}
                      type="button"
                      disabled={pending}
                      onClick={() => submit(o)}
                      className={cn(
                        "flex min-h-16 flex-col items-start justify-center rounded-lg border-2 px-3 py-2 text-left disabled:opacity-50",
                        tone === "great" && "border-accent bg-accent text-accent-ink",
                        tone === "good" && "border-ink bg-surface text-ink",
                        tone === "neutral" && "border-line bg-surface text-ink",
                        tone === "bad" && "border-line bg-surface text-danger",
                      )}
                    >
                      <span className="font-display text-base font-bold leading-tight">{OUTCOMES[o].label}</span>
                      <span className={cn("num label text-xs", tone === "great" ? "text-accent-ink/80" : "text-muted")}>+{pts}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {pending && <p className="label text-center text-sm text-muted">Logging…</p>}
        </div>
      )}
    </Sheet>
  );
}
