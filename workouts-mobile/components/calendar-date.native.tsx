import { useState } from "react";
import { Platform } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { Button, ButtonRow, Copy } from "./ui";
import type { CalendarDateProps } from "./calendar-date";
import { isISODate } from "@/lib/sharing";
import { toISODate, todayISODate } from "@/lib/calendar-date";
import { formatPlanDate } from "@/lib/plan-presentation";
import { useColors } from "./design/foundation";
function localDate(value: string | null | undefined) {
  if (value && isISODate(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
}
export function CalendarDate({ label, value, onChange, optional, disabled, min }: CalendarDateProps) {
  const [open, setOpen] = useState(false);
  const c = useColors();
  const name = label.toLowerCase();
  return (
    <>
      <Copy kind="label">
        {label}
        {optional ? " · optional" : ""}
      </Copy>
      <Copy>{value ? formatPlanDate(value) : "Not specified"}</Copy>
      <ButtonRow>
        <Button secondary icon="calendar-outline" disabled={disabled} title={value ? "Change date" : "Choose date"}
          accessibilityLabel={`${value ? "Change" : "Choose"} ${name}`} onPress={() => {
            // The picker opens on today; opening it from empty already picks that day, so Done never leaves it blank.
            if (!value && !open) onChange(todayISODate(min));
            setOpen(!open);
          }} />
        {value && optional
          ? <Button secondary disabled={disabled} title="Clear" accessibilityLabel={`Clear ${name}`} onPress={() => { setOpen(false); onChange(null); }} />
          : !value ? <Button secondary disabled={disabled} title="Use today" accessibilityLabel={`Use today for ${name}`} onPress={() => onChange(todayISODate(min))} /> : null}
      </ButtonRow>
      {open && !disabled && (
        <>
          <DateTimePicker
            value={localDate(value ?? todayISODate(min))}
            mode="date"
            accentColor={c.action}
            minimumDate={min && isISODate(min) ? localDate(min) : undefined}
            display={Platform.OS === "ios" ? "inline" : "default"}
            onValueChange={(_event, date) => {
              if (date) onChange(toISODate(date));
              if (Platform.OS === "android") setOpen(false);
            }}
          />
          {Platform.OS === "ios" && <Button title="Done" secondary onPress={() => setOpen(false)} />}
        </>
      )}
    </>
  );
}
