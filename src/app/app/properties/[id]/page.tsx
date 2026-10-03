import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { mapsUrl } from "@/lib/format";
import { PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { TouchTimeline } from "@/components/accounts/touch-timeline";
import { PropertyForm } from "@/components/accounts/forms";
import { IconDirections } from "@/components/icons";

export const metadata: Metadata = { title: "Property" };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId } = c;
  const { data: p } = await sb.from("property").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!p) notFound();
  const [accounts, touches] = await Promise.all([
    sb.from("account").select("id,name").eq("tenant_id", tenantId).is("duplicate_of", null).order("name").limit(800),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("property_id", id).order("occurred_at", { ascending: false }).limit(20),
  ]);
  const timeline = await withNames(c, touches.data ?? []);
  const directions = mapsUrl([p.address1, p.city, p.state]);
  return (
    <div>
      <LogContext propertyId={id} accountId={p.account_id} />
      <PageHeader
        back={p.account_id ? `/app/accounts/${p.account_id}` : "/app/accounts"}
        title={p.name || p.address1 || "Property"}
        sub={[p.address1, p.city, p.state].filter(Boolean).join(", ")}
      />
      <div className="flex gap-2 px-4 pt-2">
        <LogButton target={{ propertyId: id, accountId: p.account_id }} variant="primary" className="flex-1" label="Log at this building" />
        {directions && (
          <a href={directions} target="_blank" rel="noreferrer" className={btn("secondary", "md")}>
            <IconDirections size={20} /> Directions
          </a>
        )}
      </div>
      {timeline.length > 0 && (
        <>
          <SectionTitle>Touches here</SectionTitle>
          <TouchTimeline touches={timeline} />
        </>
      )}
      <SectionTitle>Building & roof</SectionTitle>
      <PropertyForm p={{ ...p, roof_area_sf: p.roof_area_sf == null ? null : Number(p.roof_area_sf) }} accounts={accounts.data ?? []} />
    </div>
  );
}
