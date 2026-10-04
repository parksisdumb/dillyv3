import Link from "next/link";
import { cn } from "@/components/ui/styles";

export function FilterChip({ href, active, children, tone = "ink" }: { href: string; active: boolean; children: React.ReactNode; tone?: "ink" | "accent" }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "label inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm",
        active ? (tone === "accent" ? "border-accent bg-accent text-accent-ink" : "border-ink bg-ink text-ground") : "border-line bg-surface",
      )}
    >
      {children}
    </Link>
  );
}

/** Build a list URL from current params plus a patch (undefined/"" removes a key). */
export function hrefWith(base: string, sp: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
