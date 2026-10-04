"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/styles";

export function AdminNav({ sections, current }: { sections: { href: string; label: string }[]; current?: string }) {
  const pathname = usePathname();
  const path = current ?? pathname;
  return (
    <nav aria-label="Admin sections" className="mx-4 flex gap-1 overflow-x-auto border-b-2 border-line">
      {sections.map((s) => {
        const on = path === s.href || path.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={cn("label -mb-0.5 inline-flex min-h-12 shrink-0 items-center border-b-4 px-3 text-sm", on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
