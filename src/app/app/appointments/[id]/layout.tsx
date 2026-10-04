import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";

/** Real 404 for appointments outside this company (same idea as requireRecord): resolved outside the page body. */
export default async function AppointmentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb.from("appointment").select("id").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(`appointment ${id}: ${error.message}`);
  if (!data) notFound();
  return children;
}
