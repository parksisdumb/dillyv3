import clsx from "clsx";

export { clsx as cn };

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "md" | "lg" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-display font-semibold select-none whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95",
  secondary: "bg-surface text-ink border-2 border-line hover:border-ink",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-surface text-danger border-2 border-danger hover:bg-danger hover:text-white",
  success: "bg-success text-white hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-12 px-4 text-base",
  lg: "min-h-14 px-5 text-xl",
};

export function btn(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return clsx(base, variants[variant], sizes[size], extra);
}

export const input =
  "w-full min-h-12 rounded-lg border-2 border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none";

export const labelText = "label text-xs text-muted";
