import { getSession } from "@/lib/session";
import { TopBar } from "@/components/shell/top-bar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { LogProvider } from "@/components/log/log-provider";
import { FloatingLogButton } from "@/components/log/log-button";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  return (
    <ToastProvider>
      <LogProvider>
        <TopBar
          tenant={{ slug: s.tenant.slug, name: s.tenant.name, role: s.tenant.role }}
          tenants={s.tenants.map((t) => ({ slug: t.slug, name: t.name, role: t.role }))}
          fullName={s.fullName}
          email={s.email}
          isManager={s.isManager}
        />
        <main className="mx-auto w-full max-w-3xl pb-[calc(env(safe-area-inset-bottom)+160px)]">{children}</main>
        <FloatingLogButton />
        <BottomNav isManager={s.isManager} />
      </LogProvider>
    </ToastProvider>
  );
}
