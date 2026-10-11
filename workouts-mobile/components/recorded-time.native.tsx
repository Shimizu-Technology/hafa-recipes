import { useState } from "react";
import { Platform } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { Button, Copy } from "./ui";
import type { RecordedTimeProps } from "./recorded-time";
export function RecordedTime({ value, onChange, label, disabled }: RecordedTimeProps) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  if (disabled && !value)
    return (
      <>
        <Copy kind="label">{label}</Copy>
        <Copy>Recorded time unknown</Copy>
      </>
    );
  return (
    <>
      <Copy kind="label">{label}</Copy>
      <Copy>{value ? date.toLocaleString() : "Choose when you took this measurement."}</Copy>
      <Copy kind="small">Device timezone · {Intl.DateTimeFormat().resolvedOptions().timeZone}</Copy>
      {Platform.OS === "ios" ? (
        <DateTimePicker
          value={date}
          mode="datetime"
          maximumDate={new Date()}
          display="compact"
          disabled={disabled}
          onValueChange={(_event, chosen) => {
            if (chosen) onChange(chosen.toISOString());
          }}
        />
      ) : (
        <>
          <Button title="Choose measurement date" secondary disabled={disabled} onPress={() => setMode("date")} />
          <Button title="Choose measurement time" secondary disabled={disabled} onPress={() => setMode("time")} />
          {!!mode && (
            <DateTimePicker
              value={date}
              mode={mode}
              maximumDate={mode === "date" ? new Date() : undefined}
              onDismiss={() => setMode(null)}
              onValueChange={(_event, chosen) => {
                setMode(null);
                if (chosen) onChange(chosen.toISOString());
              }}
            />
          )}
        </>
      )}
      <Button
        title="Use current date and time"
        secondary
        disabled={disabled}
        onPress={() => onChange(new Date().toISOString())}
      />
    </>
  );
}
