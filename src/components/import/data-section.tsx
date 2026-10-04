import Link from "next/link";
import { SectionTitle } from "@/components/ui/bits";
import { btn, input, labelText } from "@/components/ui/styles";
import { addDays } from "@/lib/format";

/** Settings → Data (managers): import a spreadsheet, export the book as CSV. */
export function DataSection({ ownerish, today, members }: { ownerish: boolean; today: string; members: { user_id: string; name: string }[] }) {
  const exp = (kind: string, q = "scope=all") => `/app/export/${kind}?${q}`;
  return (
    <>
      <SectionTitle>Data — import &amp; export</SectionTitle>
      <div className="border-y border-line bg-surface px-4 py-4">
        <Link href="/app/import" className={btn("primary", "md", "w-full")}>
          Import a spreadsheet
        </Link>
        <p className="mt-2 text-sm text-muted">Companies, contacts and properties from a CSV or a paste. Duplicates are matched before anything is saved; undo within 24 hours.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <a className={btn("secondary", "sm")} href={exp("accounts")} download>
            Accounts CSV
          </a>
          <a className={btn("secondary", "sm")} href={exp("contacts")} download>
            Contacts CSV
          </a>
          <a className={btn("secondary", "sm")} href={exp("properties")} download>
            Properties CSV
          </a>
          <a className={btn("secondary", "sm")} href={exp("opportunities")} download>
            Opportunities CSV
          </a>
        </div>
        <form method="get" action="/app/export/touches" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Touches from</span>
            <input className={input} type="date" name="from" defaultValue={addDays(today, -29)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>To</span>
            <input className={input} type="date" name="to" defaultValue={today} />
          </label>
          {ownerish ? (
            <label className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <span className={labelText}>Rep</span>
              <select name="rep" className={`${input} appearance-auto`} defaultValue="">
                <option value="">Whole team</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="col-span-2 self-center text-sm text-muted sm:col-span-1">Your touches (whole-team export is for owners and admins).</p>
          )}
          <button type="submit" className={btn("secondary", "md", "col-span-2 sm:col-span-1")}>
            Touches CSV
          </button>
        </form>
      </div>
    </>
  );
}
