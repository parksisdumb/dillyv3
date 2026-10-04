import { adminCtx } from "@/lib/server/admin";

/** Owners and admins only (managers get a real 404 here; they see Team read-only). */
export default async function OwnerAdminLayout({ children }: { children: React.ReactNode }) {
  await adminCtx("admin");
  return children;
}
