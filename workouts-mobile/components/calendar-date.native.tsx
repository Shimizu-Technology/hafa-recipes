import { useState } from "react";
import { Platform } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { Button, Copy } from "./ui";
import type { CalendarDateProps } from "./calendar-date";
import { isISODate } from "@/lib/sharing";
function localDate(value: string | null | undefined) {
  if (value && isISODate(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
}
export function CalendarDate({ label, value, onChange, optional, disabled }: CalendarDateProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Copy kind="label">
        {label}
        {optional ? " · optional" : ""}
      </Copy>
      <Copy>{value || "Not specified"}</Copy>
      <Button secondary disabled={disabled} title={`Choose ${label.toLowerCase()}`} onPress={() => setOpen(true)} />
      {optional && !!value && (
        <Button secondary disabled={disabled} title={`Clear ${label.toLowerCase()}`} onPress={() => onChange(null)} />
      )}
      {open && !disabled && (
        <>
          <DateTimePicker
            value={localDate(value)}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onValueChange={(_event, date) => {
              if (date) {
                onChange(
                  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                );
              }
              if (Platform.OS === "android") setOpen(false);
            }}
          />
          {Platform.OS === "ios" && <Button title="Done choosing date" secondary onPress={() => setOpen(false)} />}
        </>
      )}
    </>
  );
}
