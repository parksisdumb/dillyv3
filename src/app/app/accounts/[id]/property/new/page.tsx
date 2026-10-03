import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { PageHeader } from "@/components/ui/bits";
import { PropertyForm } from "@/components/accounts/forms";

export const metadata: Metadata = { title: "New property" };

export default async function NewProperty({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, tenantId } = await ctx();
  const { data: a } = await sb.from("account").select("id,name,city,state").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!a) notFound();
  return (
    <div>
      <PageHeader back={`/app/accounts/${id}`} title="New property" sub={a.name} />
      <PropertyForm p={{ account_id: a.id, city: a.city, state: a.state }} />
    </div>
  );
}
