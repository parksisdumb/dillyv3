import Link from "next/link";
import { IconChevronRight } from "@/components/icons";
import { cn } from "@/components/ui/styles";

export function TeamCard({
  href,
  title,
  big,
  sub,
  tone = "ink",
  children,
}: {
  href: string;
  title: string;
  big: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ink" | "warn" | "bad" | "good";
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border-2 border-line bg-surface">
      <Link href={href} className="flex items-start gap-3 px-4 pb-2 pt-3 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <h2 className="label text-xs text-muted">{title}</h2>
          <div
            className={cn(
              "num font-display text-4xl font-extrabold leading-tight",
              tone === "warn" && "text-warning",
              tone === "bad" && "text-danger",
              tone === "good" && "text-success",
            )}
          >
            {big}
          </div>
          {sub && <div className="text-sm text-muted">{sub}</div>}
        </div>
        <IconChevronRight className="mt-2 text-muted" />
      </Link>
      {children && <div className="border-t border-line">{children}</div>}
    </section>
  );
}
