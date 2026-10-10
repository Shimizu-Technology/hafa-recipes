import { useEffect, useState } from "react";
import { Field } from "./ui";
import { optionalNumber } from "@/lib/profile-context";
export function OptionalNumber({
  label,
  value,
  onChange,
  toDisplay = (n) => n,
  toCanonical = (n) => n,
}: {
  label: string;
  value: number | null | undefined;
  onChange(value: number | null): void;
  toDisplay?: (n: number) => number;
  toCanonical?: (n: number) => number;
}) {
  const format = () => (value == null ? "" : String(Math.round(toDisplay(value) * 1000) / 1000));
  const [text, setText] = useState(format);
  useEffect(() => {
    const parsed = optionalNumber(text);
    if (value == null && parsed == null) return;
    if (
      value != null &&
      parsed != null &&
      (Object.is(toCanonical(parsed), value) || Math.abs(toCanonical(parsed) - value) < 1e-8)
    )
      return;
    setText(format());
  }, [value, toDisplay, toCanonical]);
  return (
    <Field
      optional
      numeric
      label={label}
      value={text}
      onChange={(input) => {
        setText(input);
        const number = optionalNumber(input);
        onChange(number == null ? null : toCanonical(number));
      }}
    />
  );
}
