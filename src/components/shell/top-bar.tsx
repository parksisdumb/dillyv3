"use client";
import Link from "next/link";
import { useState } from "react";
import { signOut, switchTenant } from "@/lib/actions/auth";
import { Sheet } from "@/components/ui/sheet";
import { btn, cn } from "@/components/ui/styles";
import { IconCheck, IconChevronDown, IconLogout, IconSearch, IconSettings, IconUser, IconTrophy } from "@/components/icons";
import { initials } from "@/lib/format";
import { QueuePill } from "@/components/offline/queue-pill";

type T = { slug: string; name: string; role: string };

export function TopBar({
  tenant,
  tenants,
  fullName,
  email,
  isManager,
}: {
  tenant: T;
  tenants: T[];
  fullName: string | null;
  email: string;
  isManager: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const multi = tenants.length > 1;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-2">
        <span className="ml-2 inline-block size-3 shrink-0 rounded-sm bg-accent" aria-hidden />
        {multi ? (
          <button
            type="button"
            onClick={() => setSwitcher(true)}
            className="flex min-h-12 min-w-0 items-center gap-1 rounded-lg px-2 hover:bg-surface-2"
            aria-label={`Company: ${tenant.name}. Switch company`}
          >
            <span className="truncate font-display text-base font-bold">{tenant.name}</span>
            <IconChevronDown size={18} className="shrink-0 text-muted" />
          </button>
        ) : (
          <span className="truncate px-2 font-display text-base font-bold">{tenant.name}</span>
        )}
        <div className="flex-1" />
        <Link href="/app/search" className="inline-flex size-12 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Search accounts, contacts, properties">
          <IconSearch />
        </Link>
        <button
          type="button"
          onClick={() => setMenu(true)}
          className="inline-flex size-12 items-center justify-center rounded-lg hover:bg-surface-2"
          aria-label="Profile menu"
        >
          <span className="label inline-flex size-9 items-center justify-center rounded-full bg-ink text-sm text-ground">{initials(fullName ?? email)}</span>
        </button>
      </div>
      <QueuePill />

      <Sheet open={menu} onClose={() => setMenu(false)} title="Account" labelledBy="profile-sheet">
        <div className="px-4 pt-3">
          <div className="font-display text-xl font-bold">{fullName ?? email}</div>
          <div className="text-sm text-muted">
            {email} · <span className="label">{tenant.role}</span>
          </div>
        </div>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {isManager && (
            <li>
              <Link href="/app/me" onClick={() => setMenu(false)} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2">
                <IconTrophy size={20} /> My points & badges
              </Link>
            </li>
          )}
          {!isManager && (
            <li>
              <Link href="/app/approvals" onClick={() => setMenu(false)} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2">
                <IconCheck size={20} /> Approvals
              </Link>
            </li>
          )}
          <li>
            <Link href="/app/settings" onClick={() => setMenu(false)} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2">
              <IconSettings size={20} /> Settings
            </Link>
          </li>
          {multi && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setSwitcher(true);
                }}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2"
              >
                <IconUser size={20} /> Switch company
              </button>
            </li>
          )}
        </ul>
        <form action={signOut} className="p-4">
          <button type="submit" className={btn("secondary", "lg", "w-full")}>
            <IconLogout size={20} /> Sign out
          </button>
        </form>
      </Sheet>

      {multi && (
        <Sheet open={switcher} onClose={() => setSwitcher(false)} title="Switch company" labelledBy="tenant-sheet">
          <ul className="divide-y divide-line">
            {tenants.map((t) => (
              <li key={t.slug}>
                <form action={switchTenant.bind(null, t.slug)}>
                  <button
                    type="submit"
                    className={cn("flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2", t.slug === tenant.slug && "font-bold")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.name}</span>
                      <span className="label block text-xs text-muted">{t.role}</span>
                    </span>
                    {t.slug === tenant.slug && <IconCheck size={20} className="text-accent" />}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </header>
  );
}
