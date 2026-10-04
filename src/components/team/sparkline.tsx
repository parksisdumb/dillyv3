// 13-week sparkline: one scale from zero, subtle area, 2px line, labeled endpoint, dashed goal line.
// Each week has a hover target with its value (native SVG <title> tooltip).
import { sparkGeometry } from "@/lib/domain/scorecard";
import { shortDate } from "@/lib/format";

export function Sparkline({
  values,
  weeks,
  goal,
  unit = "",
  label,
  width = 240,
  height = 56,
}: {
  values: (number | null)[];
  weeks: string[];
  goal: number | null;
  unit?: string;
  label: string;
  width?: number;
  height?: number;
}) {
  const endPad = 34; // room for the endpoint label
  const g = sparkGeometry(values, goal, width - endPad, height, { t: 6, r: 4, b: 3, l: 2 });
  const lastVal = [...values].reverse().find((v) => v != null);
  const step = values.length > 1 ? (width - endPad - 6) / (values.length - 1) : width;
  const fmt = (v: number | null) => (v == null ? "—" : `${v}${unit}`);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}, last 13 weeks: ${values.map(fmt).join(", ")}${goal != null ? `. Goal ${goal}${unit} a week` : ""}`}
      className="block h-auto w-full overflow-visible"
    >
      <line x1={2} x2={width - endPad} y1={g.y(0)} y2={g.y(0)} stroke="var(--line)" strokeWidth={1} />
      {g.area && <path d={g.area} fill="var(--accent)" fillOpacity={0.12} />}
      {g.goalY != null && (
        <>
          <line x1={2} x2={width - endPad} y1={g.goalY} y2={g.goalY} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 3" />
          <text x={4} y={g.goalY - 3} fontSize={9} fill="var(--muted)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
            goal
          </text>
        </>
      )}
      <path d={g.line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {g.last && (
        <>
          <circle cx={g.last[0]} cy={g.last[1]} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          <text x={g.last[0] + 6} y={g.last[1] + 4} fontSize={12} fontWeight={700} fill="var(--ink)" className="num">
            {fmt(lastVal ?? null)}
          </text>
        </>
      )}
      {values.map((v, i) => (
        <rect key={i} x={g.x(i) - step / 2} y={0} width={step} height={height} fill="transparent">
          <title>{`Week of ${shortDate(weeks[i])}: ${fmt(v)}`}</title>
        </rect>
      ))}
    </svg>
  );
}
