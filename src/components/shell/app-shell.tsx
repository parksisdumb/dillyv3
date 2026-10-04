import { TopBar } from "@/components/shell/top-bar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { LogProvider } from "@/components/log/log-provider";
import { FloatingLogButton } from "@/components/log/log-button";
import { OfflineQueueProvider } from "@/components/offline/offline-queue";
import type { QueuedLog } from "@/lib/offline/types";
import { ClientErrorContext } from "@/components/observability/client-errors";
import { NavProgress } from "@/components/shell/nav-progress";
import { Suspense } from "react";

type T = { slug: string; name: string; role: string };

/** Signed-in chrome: top bar, content, floating Log button, bottom nav. */
export function AppShell({
  tenant,
  tenants,
  fullName,
  email,
  isManager,
  activeHref,
  queuePreview,
  userId = "00000000-0000-4000-8000-000000000000",
  tenantId = "00000000-0000-4000-8000-000000000000",
  children,
}: {
  /** Dev preview only: show these as queued (no IndexedDB, no replay). */
  queuePreview?: QueuedLog[];
  /** Offline queue + error reports are scoped to the signed-in user and active company. */
  userId?: string;
  tenantId?: string;
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
      <ClientErrorContext user={userId} tenant={tenantId} />
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      <OfflineQueueProvider userId={userId} tenantId={tenantId} seed={queuePreview}>
        <LogProvider>
          <TopBar tenant={tenant} tenants={tenants} fullName={fullName} email={email} isManager={isManager} />
          <main className="mx-auto w-full max-w-3xl pb-[calc(env(safe-area-inset-bottom)+168px)]">{children}</main>
          <FloatingLogButton />
          <BottomNav isManager={isManager} activeHref={activeHref} />
        </LogProvider>
      </OfflineQueueProvider>
    </ToastProvider>
  );
}
