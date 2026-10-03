"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/styles";
import { IconAccounts, IconGo, IconPipeline, IconTeam, IconToday, IconUser } from "@/components/icons";

export function BottomNav({ isManager, activeHref }: { isManager: boolean; activeHref?: string }) {
  const pathname = usePathname();
  const path = activeHref ?? pathname;
  const tabs = [
    { href: "/app/today", label: "Today", Icon: IconToday },
    { href: "/app/go", label: "Go", Icon: IconGo },
    { href: "/app/accounts", label: "Accounts", Icon: IconAccounts },
    { href: "/app/pipeline", label: "Pipeline", Icon: IconPipeline },
    isManager ? { href: "/app/team", label: "Team", Icon: IconTeam } : { href: "/app/me", label: "Me", Icon: IconUser },
  ];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {tabs.map(({ href, label, Icon }) => {
          const active = path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 border-t-[3px]",
                  active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
                )}
              >
                <Icon size={24} />
                <span className="label text-xs">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
