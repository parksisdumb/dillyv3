import { TopBar } from "@/components/shell/top-bar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { LogProvider } from "@/components/log/log-provider";
import { FloatingLogButton } from "@/components/log/log-button";

type T = { slug: string; name: string; role: string };

/** Signed-in chrome: top bar, content, floating Log button, bottom nav. */
export function AppShell({
  tenant,
  tenants,
  fullName,
  email,
  isManager,
  activeHref,
  children,
}: {
  tenant: T;
  tenants: T[];
  fullName: string | null;
  email: string;
  isManager: boolean;
  activeHref?: string;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <LogProvider>
        <TopBar tenant={tenant} tenants={tenants} fullName={fullName} email={email} isManager={isManager} />
        <main className="mx-auto w-full max-w-3xl pb-[calc(env(safe-area-inset-bottom)+168px)]">{children}</main>
        <FloatingLogButton />
        <BottomNav isManager={isManager} activeHref={activeHref} />
      </LogProvider>
    </ToastProvider>
  );
}
