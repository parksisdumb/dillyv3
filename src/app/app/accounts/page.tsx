import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { ACCOUNT_TYPES } from "@/lib/domain/vocab";
import { AccountRow } from "@/components/accounts/account-row";
import { Empty, ErrorNote, PageHeader } from "@/components/ui/bits";
import { btn, cn, input } from "@/components/ui/styles";
import { IconPlus, IconSearch } from "@/components/icons";

export const metadata: Metadata = { title: "Accounts" };

const STATES = [
  { v: "", label: "All" },
  { v: "cold", label: "Cold" },
  { v: "not_started", label: "Not started" },
  { v: "active", label: "Active" },
  { v: "excluded", label: "Excluded" },
];

type SP = { q?: string; scope?: string; state?: string; type?: string; tier?: string };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, s, tenantId } = await ctx();
  const scope = sp.scope === "all" ? "all" : "mine";
  const q = cleanQuery(sp.q);

  let query = sb
    .from("account_ranked")
    .select(
      "id,name,account_type,icp_tier,relationship_state,last_touch_at,days_since_touch,property_count,contact_count,open_opps,excluded_reason,preference,city,rank_score",
    )
    .eq("tenant_id", tenantId)
    .eq("is_test", false);
  if (scope === "mine") query = query.eq("owner_user_id", s.userId);
  if (q) query = query.ilike("normalized_name", `%${q.toLowerCase()}%`);
  if (sp.state === "excluded") query = query.in("relationship_state", ["excluded", "do_not_pursue"]);
  else if (sp.state) query = query.eq("relationship_state", sp.state);
  if (sp.type && sp.type in ACCOUNT_TYPES) query = query.eq("account_type", sp.type);
  if (sp.tier && /^[1-4]$/.test(sp.tier)) query = query.eq("icp_tier", Number(sp.tier));
  const { data, error } = await query.order("rank_score", { ascending: false, nullsFirst: false }).order("name").limit(150);

  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const str = p.toString();
    return `/app/accounts${str ? `?${str}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        action={
          <Link href="/app/accounts/new" className={btn("secondary", "md")}>
            <IconPlus size={18} /> New
          </Link>
        }
      />

      <form method="get" action="/app/accounts" className="flex flex-col gap-2 px-4">
        <input type="hidden" name="scope" value={scope} />
        {sp.state && <input type="hidden" name="state" value={sp.state} />}
        <label className="relative block">
          <span className="sr-only">Search accounts</span>
          <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search by name" className={`${input} pl-10`} type="search" autoComplete="off" />
        </label>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select name="type" defaultValue={sp.type ?? ""} className={input} aria-label="Account type">
            <option value="">Any type</option>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="tier" defaultValue={sp.tier ?? ""} className={input} aria-label="Priority tier">
            <option value="">Any tier</option>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t}>
                P{t}
              </option>
            ))}
          </select>
          <button type="submit" className={btn("primary", "md")}>
            Go
          </button>
        </div>
      </form>

      <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Whose accounts">
        {(["mine", "all"] as const).map((v) => (
          <Link
            key={v}
            href={href({ scope: v })}
            aria-current={scope === v ? "true" : undefined}
            className={cn("label inline-flex min-h-10 items-center rounded-full border-2 px-4 text-sm", scope === v ? "border-ink bg-ink text-ground" : "border-line")}
          >
            {v === "mine" ? "My accounts" : "Everyone's"}
          </Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line" />
        {STATES.map((st) => (
          <Link
            key={st.v || "all"}
            href={href({ state: st.v || undefined })}
            aria-current={(sp.state ?? "") === st.v ? "true" : undefined}
            className={cn(
              "label inline-flex min-h-10 shrink-0 items-center rounded-full border-2 px-4 text-sm",
              (sp.state ?? "") === st.v ? "border-accent bg-accent text-accent-ink" : "border-line",
            )}
          >
            {st.label}
          </Link>
        ))}
      </div>

      {error && <ErrorNote>Couldn&apos;t load accounts: {error.message}</ErrorNote>}
      {data && data.length === 0 && (
        <div className="mt-4">
          <Empty title={q ? `Nothing matches “${q}”` : "No accounts here"}>
            {scope === "mine" ? (
              <Link className="underline" href={href({ scope: "all" })}>
                Look in everyone&apos;s accounts
              </Link>
            ) : (
              "Add one with New."
            )}
          </Empty>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-y border-line bg-surface">
          {data.map((a) => (
            <AccountRow key={a.id} a={a} />
          ))}
        </ul>
      )}
      {data && data.length === 150 && <p className="px-4 py-3 text-sm text-muted">Showing the top 150. Search or filter to narrow.</p>}
    </div>
  );
}
