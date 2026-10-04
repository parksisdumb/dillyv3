import Link from "next/link";
import { cn } from "@/components/ui/styles";

const TABS = [
  { key: "accounts", label: "Accounts", href: "/app/accounts" },
  { key: "contacts", label: "Contacts", href: "/app/contacts" },
  { key: "properties", label: "Properties", href: "/app/properties" },
] as const;

/** The Book: one tap between accounts, contacts and properties. */
export function BookTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Book" className="mx-4 mt-4 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn("label flex min-h-12 items-center justify-center rounded-md text-sm", active === t.key ? "bg-ink text-ground" : "text-ink hover:bg-surface")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
