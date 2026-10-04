import { requireRecord } from "@/lib/server/guard";

/** Real 404 for records outside this company (see requireRecord). */
export default async function RecordLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireRecord("contact", (await params).id);
  return children;
}
