import { cn } from "@/components/ui/styles";

/** Plain data table: dividers, tabular numbers, scrolls sideways on a phone instead of squashing. */
export function Table({ head, children, numericFrom = 1 }: { head: string[]; children: React.ReactNode; numericFrom?: number }) {
  return (
    <div className="overflow-x-auto border-y border-line bg-surface">
      <table className="num w-full min-w-[36rem] text-left text-sm">
        <thead>
          <tr className="border-b-2 border-ink">
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn("label whitespace-nowrap px-3 py-2 text-xs text-muted", i >= numericFrom && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, num = false, className }: { children: React.ReactNode; num?: boolean; className?: string }) {
  return <td className={cn("whitespace-nowrap px-3 py-3", num && "text-right", className)}>{children}</td>;
}
