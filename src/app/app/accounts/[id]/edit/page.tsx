import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { PageHeader } from "@/components/ui/bits";
import { AccountForm } from "@/components/accounts/forms";

export const metadata: Metadata = { title: "Edit account" };

export default async function EditAccount({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx();
  const { data: a } = await c.sb.from("account").select("*").eq("tenant_id", c.tenantId).eq("id", id).maybeSingle();
  if (!a) notFound();
  const members = await getMembers(c);
  return (
    <div>
      <PageHeader back={`/app/accounts/${id}`} title="Edit account" sub={a.name} />
      <AccountForm a={a} members={members} me={c.s.userId} />
    </div>
  );
}
