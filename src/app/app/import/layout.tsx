import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";

// Import is for owners, admins and managers. Checked here — outside the page's Suspense — so a rep gets a real 404.
export default async function ImportLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s.isManager) notFound();
  return children;
}
