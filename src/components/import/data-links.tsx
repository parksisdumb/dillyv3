import Link from "next/link";
import { btn } from "@/components/ui/styles";

/** Manager-only "Import · Export" row under the Book tabs. Export carries the list's current filters. */
export function DataLinks({ entity, sp }: { entity: "contacts" | "properties"; sp: Record<string, string | undefined> }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) p.set(k, v);
  if (entity === "contacts" && !p.has("scope")) p.set("scope", "mine");
  return (
    <div className="mx-4 mt-2 flex items-center justify-end gap-1">
      <Link href={`/app/import?entity=${entity}`} className={btn("ghost", "sm")}>
        Import
      </Link>
      <a href={`/app/export/${entity}?${p.toString()}`} className={btn("ghost", "sm")} download>
        Export
      </a>
    </div>
  );
}
