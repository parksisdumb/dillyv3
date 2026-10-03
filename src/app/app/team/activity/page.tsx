import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { requireManager } from "@/lib/server/guard";
import { getMembers } from "@/lib/server/members";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { CHANNELS, OUTCOMES } from "@/lib/domain/vocab";
import { Empty, PageHeader } from "@/components/ui/bits";
import { TouchTimeline } from "@/components/accounts/touch-timeline";
import { btn, input } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ rep?: string; channel?: string; outcome?: string }> }) {
  const sp = await searchParams;
  const c = await ctx();
  requireManager(c.s);
  const members = await getMembers(c);
  let q = c.sb.from("touch").select(TOUCH_COLS).eq("tenant_id", c.tenantId);
  if (sp.rep && members.some((m) => m.user_id === sp.rep)) q = q.eq("user_id", sp.rep);
  if (sp.channel && sp.channel in CHANNELS) q = q.eq("channel", sp.channel);
  if (sp.outcome && sp.outcome in OUTCOMES) q = q.eq("outcome", sp.outcome);
  const { data } = await q.order("occurred_at", { ascending: false }).limit(100);
  const rows = await withNames(c, data ?? []);

  return (
    <div>
      <PageHeader back="/app/team" title="Activity" sub="Latest 100 touches" />
      <form method="get" className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4">
        <select name="rep" defaultValue={sp.rep ?? ""} className={input} aria-label="Rep">
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
        <select name="channel" defaultValue={sp.channel ?? ""} className={input} aria-label="Channel">
          <option value="">Any channel</option>
          {Object.entries(CHANNELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select name="outcome" defaultValue={sp.outcome ?? ""} className={input} aria-label="Outcome">
          <option value="">Any outcome</option>
          {Object.entries(OUTCOMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="submit" className={btn("primary", "md")}>
          Filter
        </button>
      </form>
      {rows.length === 0 ? <Empty title="No touches match" /> : <TouchTimeline touches={rows} showAccount />}
    </div>
  );
}
