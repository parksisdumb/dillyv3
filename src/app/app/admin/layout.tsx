import { adminCtx } from "@/lib/server/admin";
import { AdminChrome, adminSections } from "@/components/admin/admin-chrome";

/**
 * Admin (owners, admins, platform admin). Managers get Team read-only; everyone else a real 404 — decided here,
 * outside any Suspense boundary, so the status line is a 404 (see requireRecord).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const c = await adminCtx("readonly");
  return (
    <AdminChrome tenantName={c.s.tenant.name} readonly={c.level === "readonly"} sections={adminSections(c.level, c.s.isPlatformAdmin)}>
      {children}
    </AdminChrome>
  );
}
