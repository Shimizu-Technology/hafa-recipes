import { useEffect, useRef, useState } from "react";
import { Button, Copy, Field, Notice } from "./ui";
import { parseRecordedTime } from "@/lib/measurements";
export interface RecordedTimeProps {
  value: string | null;
  onChange(value: string | null): void;
  label: string;
  disabled?: boolean;
}
export function RecordedTime({ value, onChange, label, disabled }: RecordedTimeProps) {
  const [text, setText] = useState(value ?? "");
  const emitted = useRef<string | null>(value);
  useEffect(() => {
    if (value !== emitted.current) {
      setText(value ?? "");
      emitted.current = value;
    }
  }, [value]);
  if (disabled && !value)
    return (
      <>
        <Copy kind="label">{label}</Copy>
        <Copy>Recorded time unknown</Copy>
      </>
    );
  return (
    <>
      <Field
        label={label}
        value={text}
        onChange={(text) => {
          if (disabled) return;
          setText(text);
          const date = parseRecordedTime(text);
          emitted.current = date;
          onChange(date);
        }}
        placeholder="2026-10-10T09:30:00+10:00"
      />
      <Copy kind="small">
        Enter a date/time with its timezone offset. Dates without an offset use this device’s local timezone.
      </Copy>
      {!!(text && !parseRecordedTime(text)) && <Notice error>Enter a valid measurement date and time.</Notice>}
      <Button
        title="Use current date and time"
        secondary
        disabled={disabled}
        onPress={() => {
          const now = new Date().toISOString();
          setText(now);
          emitted.current = now;
          onChange(now);
        }}
      />
    </>
  );
}
