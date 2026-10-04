import { notFound } from "next/navigation";
import { adminCtx } from "@/lib/server/admin";

/** Platform (companies) is Parks only: a real 404 for everyone else. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const c = await adminCtx("readonly");
  if (!c.s.isPlatformAdmin) notFound();
  return children;
}
