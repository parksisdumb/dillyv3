import Link from "next/link";
import { btn } from "@/components/ui/styles";

// Inside the app shell: notFound() from a record page (bad id, merged duplicate, another tenant's record).
export default function AppNotFound() {
  return (
    <div className="px-4 pt-8">
      <div className="rounded-lg border-2 border-dashed border-line px-4 py-8 text-center">
        <p className="font-display text-2xl font-bold">Can&apos;t find that one.</p>
        <p className="mt-2 text-sm text-muted">It may have been merged into another record, removed, or it belongs to a different company.</p>
        <Link href="/app/today" className={btn("primary", "lg", "mt-5")}>
          Go to Today
        </Link>
      </div>
    </div>
  );
}
