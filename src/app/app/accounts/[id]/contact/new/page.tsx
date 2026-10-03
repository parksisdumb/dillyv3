import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { PageHeader } from "@/components/ui/bits";
import { NewContact } from "@/components/accounts/new-contact";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, tenantId } = await ctx();
  const { data: a } = await sb.from("account").select("id,name").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!a) notFound();
  return (
    <div>
      <PageHeader back={`/app/accounts/${id}`} title="New contact" sub={a.name} />
      <div className="px-4 pt-2">
        <NewContact accountId={a.id} />
      </div>
    </div>
  );
}
