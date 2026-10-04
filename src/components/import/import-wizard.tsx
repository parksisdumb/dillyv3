"use client";
// CSV import wizard: Upload / paste → Map columns → Preview (dedupe, errors, per-record actions) → Commit in chunks
// with progress → Result (with Undo for 24 h). Nothing is written until the manager confirms on Preview.
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { applySavedMapping, detectMapping, detectPartyRole, headerSignature, mappedEntities, mappingToSaved, type Mapping } from "@/lib/domain/import/fields";
import { mapRows } from "@/lib/domain/import/rows";
import { parseSheet, csvLine, type Sheet } from "@/lib/domain/import/parse";
import {
  accountPayload,
  chunk,
  contactPayload,
  liveEntities,
  planCounts,
  planImport,
  propertyPayload,
  type Action,
  type ExistingIndex,
  type Member,
  type Plan,
} from "@/lib/domain/import/plan";
import { beginImport, finishImport, importChunk, loadImportIndex, saveImportMapping, undoImport, type UndoReport } from "@/lib/actions/import";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/vocab";
import { agoLabel, plural } from "@/lib/format";
import { Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn, cn, input } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { HideLogFab } from "@/components/log/log-provider";
import { MapStep } from "@/components/import/map-step";
import { PreviewStep, type Overrides } from "@/components/import/preview-step";
import { wide, type ImportOptions } from "@/components/import/shared";

export type SavedMapping = { name: string; header_sig: string; mapping: Record<string, string>; options: Record<string, unknown> };
export type RecentImport = {
  id: string;
  fileName: string;
  by: string;
  rowCount: number;
  counts: Record<string, number>;
  status: string;
  createdAt: string;
  undoable: boolean;
};
type TeamMember = Member & { role: string };

type Step = "source" | "map" | "preview" | "commit" | "result";

const CHUNK = { accounts: 400, contacts: 400, properties: 200 } as const;


export function ImportWizard({
  tenantName,
  year,
  members,
  me,
  saved,
  recent,
  entity,
  initial,
}: {
  tenantName: string;
  year: number;
  members: TeamMember[];
  me: string;
  saved: SavedMapping[];
  recent: RecentImport[];
  entity: "accounts" | "contacts" | "properties" | null;
  /** Design previews: start on a step with a sheet already loaded. */
  initial?: { step: Step; text: string; fileName: string; index?: ExistingIndex; overrides?: Partial<Overrides>; tab?: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const startSheet = useMemo(() => (initial ? parseSheet(initial.text) : null), [initial]);
  const [step, setStep] = useState<Step>(initial?.step ?? "source");
  const [sheet, setSheet] = useState<Sheet | null>(startSheet);
  const [fileName, setFileName] = useState(initial?.fileName ?? "");
  const [paste, setPaste] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>(() => (startSheet ? detectMapping(startSheet.headers) : {}));
  const [savedName, setSavedName] = useState<string | null>(null);
  const meIsRep = members.some((m) => m.user_id === me);
  const [opts, setOpts] = useState<ImportOptions>(() => ({
    defaultOwnerId: meIsRep ? me : null,
    partyRole: startSheet ? detectPartyRole(startSheet.headers, detectMapping(startSheet.headers)) : "manager",
    defaultType: "property_mgmt",
  }));
  const [index, setIndex] = useState<ExistingIndex | null>(initial?.index ?? (initial ? { accounts: [], contacts: [], properties: [] } : null));
  const [overrides, setOverrides] = useState<Overrides>({ accounts: {}, contacts: {}, properties: {}, include: {}, ...initial?.overrides });
  const [loading, startLoading] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>({ done: 0, total: 0, label: "" });
  const [result, setResult] = useState<{ batchId: string; counts: Record<string, number>; error?: string } | null>(null);
  const [undo, setUndo] = useState<{ id: string; report: UndoReport } | null>(null);
  const [recentRows, setRecentRows] = useState(recent);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- source ---------------------------------------------------------------------------------------------------
  const loadText = useCallback(
    (text: string, name: string) => {
      const s = parseSheet(text);
      if (s.headers.length === 0 || s.rows.length === 0) {
        setSourceError("That sheet has no data rows. The first row should be the column headers.");
        return;
      }
      const sig = headerSignature(s.headers);
      const hit = saved.find((m) => m.header_sig === sig);
      const m = hit ? applySavedMapping(s.headers, hit.mapping) : detectMapping(s.headers);
      setSheet(s);
      setFileName(name);
      setMapping(m);
      setSavedName(hit?.name ?? null);
      setOpts((o) => ({
        ...o,
        partyRole: (hit?.options?.partyRole as ImportOptions["partyRole"]) ?? detectPartyRole(s.headers, m),
        defaultType: ((hit?.options?.defaultType as AccountType) ?? o.defaultType) in ACCOUNT_TYPES ? ((hit?.options?.defaultType as AccountType) ?? o.defaultType) : o.defaultType,
      }));
      setOverrides({ accounts: {}, contacts: {}, properties: {}, include: {} });
      setSourceError(s.truncated ? `Only the first ${s.rows.length.toLocaleString()} rows were loaded — split bigger files.` : null);
      setStep("map");
    },
    [saved],
  );

  // --- plan -----------------------------------------------------------------------------------------------------
  const mapped = useMemo(() => (sheet ? mapRows(sheet.rows, mapping, year) : []), [sheet, mapping, year]);
  const basePlan = useMemo<Plan | null>(
    () => (sheet && index ? planImport(mapped, index, { defaultOwnerId: opts.defaultOwnerId, members, defaultType: opts.defaultType, partyRole: opts.partyRole }) : null),
    [sheet, index, mapped, opts, members],
  );
  const plan = useMemo<Plan | null>(() => {
    if (!basePlan) return null;
    const apply = <T extends { key: string; action: Action; match: unknown }>(xs: T[], o: Record<string, Action>) =>
      xs.map((x) => (o[x.key] && (o[x.key] !== "link" || x.match) ? { ...x, action: o[x.key]! } : x));
    return {
      accounts: apply(basePlan.accounts, overrides.accounts),
      contacts: apply(basePlan.contacts, overrides.contacts),
      properties: apply(basePlan.properties, overrides.properties),
      rows: basePlan.rows.map((r) => (r.index in overrides.include && !r.empty ? { ...r, skip: !overrides.include[r.index] } : r)),
    };
  }, [basePlan, overrides]);
  const counts = useMemo(() => (plan ? planCounts(plan) : null), [plan]);

  const toPreview = () => {
    setSourceError(null);
    if (!Object.values(mapping).includes("account_name") && !mappedEntities(mapping).contact && !mappedEntities(mapping).property) {
      setSourceError("Map at least one of: Company, a contact name or email, or a property name or address.");
      return;
    }
    if (index) {
      setStep("preview");
      return;
    }
    startLoading(async () => {
      const r = await loadImportIndex().catch(() => ({ ok: false as const, error: "Can't reach the server. Check your signal and try again." }));
      if (!r.ok) {
        setSourceError(r.error);
        return;
      }
      setIndex(r.index);
      setStep("preview");
    });
  };

  const saveMapping = (name: string) =>
    startLoading(async () => {
      if (!sheet) return;
      const r = await saveImportMapping({ name, headerSig: headerSignature(sheet.headers), mapping: mappingToSaved(sheet.headers, mapping), options: { partyRole: opts.partyRole, defaultType: opts.defaultType } });
      if (r.ok) {
        setSavedName(name);
        toast(r.message);
      } else setSourceError(r.error);
    });

  // --- commit ---------------------------------------------------------------------------------------------------
  const commit = async () => {
    if (!plan || !sheet || !counts) return;
    setStep("commit");
    const acct = accountPayload(plan);
    const live = liveEntities(plan);
    const totalChunks =
      Math.ceil(acct.length / CHUNK.accounts) +
      Math.ceil(live.contacts.filter((c) => c.action !== "skip").length / CHUNK.contacts) +
      Math.ceil(live.properties.filter((p) => p.action !== "skip").length / CHUNK.properties);
    let done = 0;
    setProgress({ done: 0, total: Math.max(totalChunks, 1), label: "Starting…" });
    const clientCounts = {
      accounts_linked: counts.accounts.link,
      contacts_linked: counts.contacts.link,
      properties_linked: counts.properties.link,
      accounts_skipped: counts.accounts.skip,
      contacts_skipped: counts.contacts.skip,
      properties_skipped: counts.properties.skip,
      rows_included: counts.rows.included,
      rows_skipped: counts.rows.skipped,
      rows_with_errors: counts.rows.errors,
    };
    const begun = await beginImport({
      fileName: fileName || "pasted rows",
      rowCount: Math.max(counts.rows.included, 1),
      mapping: mappingToSaved(sheet.headers, mapping),
      options: { ...opts },
    }).catch(() => ({ ok: false as const, error: "Can't reach the server." }));
    if (!begun.ok) {
      setResult({ batchId: "", counts: {}, error: begun.error });
      setStep("result");
      return;
    }
    const batchId = begun.batchId;
    // A chunk is safe to resend: the database recognizes rows it already wrote for this batch.
    const send = async (kind: "accounts" | "contacts" | "properties", rows: Record<string, unknown>[], label: string) => {
      const ids: Record<string, string> = {};
      const parts = chunk(rows, CHUNK[kind]);
      for (let i = 0; i < parts.length; i++) {
        setProgress({ done, total: Math.max(totalChunks, 1), label: `${label} ${Math.min((i + 1) * CHUNK[kind], rows.length).toLocaleString()} of ${rows.length.toLocaleString()}` });
        let last = "";
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          const r = await importChunk({ batchId, kind, rows: parts[i]! }).catch(() => ({ ok: false as const, error: "Lost the connection." }));
          if (r.ok) {
            Object.assign(ids, r.ids);
            ok = true;
          } else last = r.error;
        }
        if (!ok) throw new Error(last);
        done++;
        setProgress({ done, total: Math.max(totalChunks, 1), label });
      }
      return ids;
    };
    try {
      const accountIds = await send("accounts", acct, "Companies");
      const contactIds = await send("contacts", contactPayload(plan, accountIds), "Contacts");
      await send("properties", propertyPayload(plan, accountIds, contactIds, opts.partyRole), "Properties");
      const fin = await finishImport(batchId, "done", clientCounts);
      setResult({ batchId, counts: fin.ok ? fin.counts : clientCounts, error: fin.ok ? undefined : fin.error });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The import stopped.";
      const fin = await finishImport(batchId, "failed", clientCounts, msg).catch(() => null);
      setResult({ batchId, counts: fin && fin.ok ? fin.counts : {}, error: msg });
    }
    setStep("result");
    router.refresh();
  };

  const runUndo = (batchId: string) =>
    startLoading(async () => {
      if (!window.confirm("Undo this import? Records it created are deleted unless someone has logged work on them since.")) return;
      const r = await undoImport(batchId).catch(() => ({ ok: false as const, error: "Can't reach the server." }));
      if (!r.ok) {
        toast(r.error, "bad");
        return;
      }
      setUndo({ id: batchId, report: r.report });
      const kept = r.report.kept.accounts.length + r.report.kept.contacts.length + r.report.kept.properties.length;
      setRecentRows((xs) => xs.map((x) => (x.id === batchId ? { ...x, status: kept ? "partially_undone" : "undone", undoable: false } : x)));
      toast(kept ? `Undone, except ${kept} ${kept === 1 ? "record" : "records"} with activity` : "Import undone");
      router.refresh();
    });

  const reset = () => {
    setStep("source");
    setSheet(null);
    setPaste("");
    setResult(null);
    setUndo(null);
    setIndex(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // --- render ---------------------------------------------------------------------------------------------------
  const STEPS: { k: Step; label: string }[] = [
    { k: "source", label: "Upload" },
    { k: "map", label: "Map" },
    { k: "preview", label: "Preview" },
    { k: "result", label: "Done" },
  ];
  const stepIdx = STEPS.findIndex((s) => s.k === (step === "commit" ? "result" : step));

  return (
    <div className={wide}>
      <PageHeader
        title="Import"
        back={entity ? `/app/${entity}` : "/app/accounts"}
        sub={`${tenantName} · companies, contacts and properties from a spreadsheet`}
      />
      <ol className="mx-4 mb-2 grid grid-cols-4 gap-1" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.k} aria-current={i === stepIdx ? "step" : undefined} className="flex flex-col gap-1">
            <span className={cn("h-1.5 rounded-full", i <= stepIdx ? "bg-accent" : "bg-surface-2")} />
            <span className={cn("label truncate text-xs", i === stepIdx ? "text-ink" : "text-muted")}>{s.label}</span>
          </li>
        ))}
      </ol>
      {step !== "source" && <HideLogFab />}

      {step === "source" && (
        <>
          <div className="mx-4 mt-3 grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border-2 border-line bg-surface p-4">
              <h2 className="font-display text-lg font-bold">Upload a CSV</h2>
              <p className="mt-1 text-sm text-muted">
                Works best with one row per property — its management company (or owner) and the on-site contact. A sheet of just companies or just contacts works
                too.
              </p>
              <label className={cn(btn("primary", "lg", "mt-4 w-full cursor-pointer"))}>
                Choose file
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  className="sr-only"
                  aria-label="CSV file"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 15 * 1024 * 1024) {
                      setSourceError("That file is over 15 MB. Split it and import in parts.");
                      return;
                    }
                    loadText(await f.text(), f.name);
                  }}
                />
              </label>
              <button
                type="button"
                className={btn("ghost", "sm", "mt-2 w-full")}
                onClick={() => {
                  const headers = ["Management Company", "Property Name", "Address", "City", "State", "Zip", "Units", "Roof Type", "Roof Year", "Sq Ft", "First Name", "Last Name", "Title", "Email", "Phone", "Rep Email", "Notes"];
                  const blob = new Blob([csvLine(headers)], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "dilly-import-template.csv";
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download a blank template
              </button>
            </section>
            <section className="rounded-lg border-2 border-line bg-surface p-4">
              <h2 className="font-display text-lg font-bold">…or paste rows</h2>
              <p className="mt-1 text-sm text-muted">Copy from Excel or Google Sheets, header row included.</p>
              <label className="mt-3 block">
                <span className="sr-only">Pasted rows</span>
                <textarea
                  className={cn(input, "min-h-32 py-2 font-mono text-sm")}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={"Company\tProperty\tAddress\tCity\nBluff City Residential\tOverton Flats\t1820 Madison Ave\tMemphis"}
                />
              </label>
              <button type="button" className={btn("secondary", "md", "mt-2 w-full")} disabled={!paste.trim()} onClick={() => loadText(paste, "pasted rows")}>
                Use pasted rows
              </button>
            </section>
          </div>
          {sourceError && (
            <p role="alert" className="mx-4 mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
              {sourceError}
            </p>
          )}
          <RecentImports rows={recentRows} onUndo={runUndo} pending={loading} undo={undo} />
        </>
      )}

      {step === "map" && sheet && (
        <MapStep
          sheet={sheet}
          fileName={fileName}
          mapping={mapping}
          onMapping={(m) => {
            setMapping(m);
            setOverrides({ accounts: {}, contacts: {}, properties: {}, include: {} });
          }}
          opts={opts}
          onOpts={setOpts}
          members={members}
          savedName={savedName}
          onSave={saveMapping}
          error={sourceError}
          pending={loading}
          onBack={reset}
          onNext={toPreview}
        />
      )}

      {step === "preview" && plan && counts && (
        <PreviewStep
          plan={plan}
          counts={counts}
          members={members}
          opts={opts}
          onOpts={setOpts}
          overrides={overrides}
          onOverrides={setOverrides}
          initialTab={initial?.tab}
          onBack={() => setStep("map")}
          onConfirm={commit}
        />
      )}

      {step === "commit" && (
        <section className="mx-4 mt-4 rounded-lg border-2 border-line bg-surface p-4" aria-live="polite">
          <h2 className="font-display text-xl font-bold">Importing…</h2>
          <p className="mt-1 text-sm text-muted">Keep this screen open. Each chunk is saved as it goes.</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Import progress">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
          <p className="num mt-2 text-sm">{progress.label}</p>
        </section>
      )}

      {step === "result" && result && (
        <ResultCard result={result} undo={undo && undo.id === result.batchId ? undo.report : null} pending={loading} onUndo={() => runUndo(result.batchId)} onAgain={reset} />
      )}
    </div>
  );
}

function ResultCard({
  result,
  undo,
  pending,
  onUndo,
  onAgain,
}: {
  result: { batchId: string; counts: Record<string, number>; error?: string };
  undo: UndoReport | null;
  pending: boolean;
  onUndo: () => void;
  onAgain: () => void;
}) {
  const c = result.counts;
  const tiles: [string, number, number][] = [
    ["Companies", c.accounts_created ?? 0, c.accounts_linked ?? 0],
    ["Contacts", c.contacts_created ?? 0, c.contacts_linked ?? 0],
    ["Properties", c.properties_created ?? 0, c.properties_linked ?? 0],
  ];
  return (
    <section className="mx-4 mt-4 rounded-lg border-2 border-line bg-surface p-4">
      {result.error ? (
        <>
          <h2 className="font-display text-xl font-bold text-danger">The import stopped</h2>
          <p role="alert" className="mt-1 text-sm">
            {result.error}
          </p>
          {result.batchId && <p className="mt-1 text-sm text-muted">What was saved before it stopped is below. Undo it, fix the sheet, and import again.</p>}
        </>
      ) : undo ? (
        <h2 className="font-display text-xl font-bold">Import undone</h2>
      ) : (
        <h2 className="font-display text-xl font-bold">Imported</h2>
      )}
      {!undo && (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {tiles.map(([label, made, linked]) => (
            <div key={label} className="rounded-lg bg-surface-2 p-3">
              <dt className="label text-xs text-muted">{label}</dt>
              <dd className="num font-display text-3xl font-extrabold leading-tight">{made}</dd>
              <dd className="num text-xs text-muted">new · {linked} linked</dd>
            </div>
          ))}
        </dl>
      )}
      {undo && <UndoSummary report={undo} />}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/app/accounts?scope=all" className={btn("primary", "md")}>
          View accounts
        </Link>
        {result.batchId && !undo && (
          <button type="button" className={btn("danger", "md")} disabled={pending} onClick={onUndo}>
            {pending ? "Undoing…" : "Undo this import"}
          </button>
        )}
        <button type="button" className={btn("secondary", "md")} onClick={onAgain}>
          Import another
        </button>
      </div>
      {result.batchId && !undo && <p className="mt-2 text-xs text-muted">Undo is available for 24 hours, from here or Import → Recent imports.</p>}
    </section>
  );
}

function UndoSummary({ report }: { report: UndoReport }) {
  const d = report.deleted;
  const kept = [...report.kept.accounts.map((x) => ({ ...x, kind: "Company" })), ...report.kept.contacts.map((x) => ({ ...x, kind: "Contact" })), ...report.kept.properties.map((x) => ({ ...x, kind: "Property" }))];
  return (
    <div className="mt-2 text-sm">
      <p className="num">
        Removed {plural(d.accounts, "company", "companies")}, {plural(d.contacts, "contact")}, {plural(d.properties, "property", "properties")}.
      </p>
      {kept.length > 0 && (
        <>
          <p className="mt-2 font-semibold">Kept — someone has logged work on these since the import:</p>
          <ul className="mt-1 list-disc pl-5">
            {kept.slice(0, 20).map((k) => (
              <li key={k.id}>
                {k.kind}: {k.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  done: { label: "Imported", tone: "good" },
  running: { label: "Incomplete", tone: "warn" },
  failed: { label: "Stopped", tone: "bad" },
  undone: { label: "Undone", tone: "neutral" },
  partially_undone: { label: "Partly undone", tone: "warn" },
};

function RecentImports({ rows, onUndo, pending, undo }: { rows: RecentImport[]; onUndo: (id: string) => void; pending: boolean; undo: { id: string; report: UndoReport } | null }) {
  if (rows.length === 0) return null;
  return (
    <>
      <SectionTitle>Recent imports</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface">
        {rows.map((r) => {
          const st = STATUS[r.status] ?? STATUS.done;
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.fileName}</div>
                  <div className="num text-sm text-muted">
                    {r.by} · {agoLabel(r.createdAt)} · {r.counts.accounts_created ?? 0} companies, {r.counts.contacts_created ?? 0} contacts, {r.counts.properties_created ?? 0} properties
                  </div>
                </div>
                <Chip tone={st.tone}>{st.label}</Chip>
                {r.undoable && (
                  <button type="button" className={btn("secondary", "sm")} disabled={pending} onClick={() => onUndo(r.id)} aria-label={`Undo import ${r.fileName}`}>
                    Undo
                  </button>
                )}
              </div>
              {undo?.id === r.id && <UndoSummary report={undo.report} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

