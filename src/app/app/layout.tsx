import { getSession } from "@/lib/session";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  return (
    <AppShell
      tenant={{ slug: s.tenant.slug, name: s.tenant.name, role: s.tenant.role }}
      tenants={s.tenants.map((t) => ({ slug: t.slug, name: t.name, role: t.role }))}
      fullName={s.fullName}
      email={s.email}
      isManager={s.isManager}
      userId={s.userId}
      tenantId={s.tenant.id}
    >
      {children}
    </AppShell>
  );
}
