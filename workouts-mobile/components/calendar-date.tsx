import { Field } from "./ui";
export interface CalendarDateProps {
  label: string;
  value: string | null | undefined;
  onChange(value: string | null): void;
  optional?: boolean;
  disabled?: boolean;
}
export function CalendarDate({ label, value, onChange, optional, disabled }: CalendarDateProps) {
  return (
    <Field
      label={`${label} · YYYY-MM-DD`}
      value={value ?? ""}
      optional={optional}
      disabled={disabled}
      onChange={(text) => onChange(text || null)}
      placeholder="YYYY-MM-DD"
    />
  );
}
