// Labeled form fields (server-safe, uncontrolled).
import { cn, input, labelText } from "@/components/ui/styles";

type Common = { label: string; name: string; hint?: string; className?: string; required?: boolean };

export function TextField({
  label,
  name,
  hint,
  className,
  required,
  type = "text",
  defaultValue,
  placeholder,
  inputMode,
  autoComplete,
  min,
  step,
}: Common & {
  type?: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  min?: string | number;
  step?: string | number;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={labelText}>
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <input
        className={input}
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        min={min}
        step={step}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, name, hint, className, defaultValue, placeholder, rows = 3 }: Common & { defaultValue?: string | null; placeholder?: string; rows?: number }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={labelText}>{label}</span>
      <textarea className={cn(input, "py-2")} name={name} rows={rows} defaultValue={defaultValue ?? undefined} placeholder={placeholder} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  name,
  hint,
  className,
  required,
  options,
  defaultValue,
  placeholder,
}: Common & { options: { value: string; label: string }[]; defaultValue?: string | number | null; placeholder?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={labelText}>
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <select className={cn(input, "appearance-auto")} name={name} required={required} defaultValue={defaultValue == null ? "" : String(defaultValue)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function opts<T extends Record<string, string | { label: string }>>(rec: T): { value: string; label: string }[] {
  return Object.entries(rec).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));
}
