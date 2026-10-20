import { useState } from "react";
import { Modal, Platform, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button, Card, Copy, useColors } from "./ui";
export function DateField({
  label,
  value,
  onChange,
  dateOnly = false,
  optional = false,
}: {
  label: string;
  value?: string | null;
  onChange: (iso: string) => void;
  dateOnly?: boolean;
  optional?: boolean;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null),
    [draft, setDraft] = useState(new Date()),
    c = useColors();
  const parsed = value ? new Date(dateOnly ? value + "T12:00:00" : value) : new Date(),
    valid = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  function change(date: Date) {
    onChange(
      dateOnly
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : date.toISOString()
    );
  }
  function open(m: "date" | "time") {
    setDraft(valid);
    setMode(m);
  }
  return (
    <View style={{ gap: 8 }}>
      <Copy kind="small">{label}</Copy>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          secondary
          title={
            value
              ? valid.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
              : "Choose date"
          }
          onPress={() => open("date")}
        />
        {!dateOnly && (
          <Button
            secondary
            title={valid.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            onPress={() => open("time")}
          />
        )}
        {optional && !!value && <Button variant="ghost" title="Clear date" onPress={() => onChange("")} />}
      </View>
      {mode && Platform.OS === "android" && (
        <DateTimePicker
          value={valid}
          mode={mode}
          onChange={(event, date) => {
            setMode(null);
            if (event.type === "set" && date) change(date);
          }}
        />
      )}
      {mode && Platform.OS !== "android" && (
        <Modal transparent animationType="none" onRequestClose={() => setMode(null)}>
          <View
            style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end", padding: 18, paddingBottom: 36 }}
          >
            <Card>
              <Copy kind="heading">{label}</Copy>
              <DateTimePicker
                value={draft}
                mode={mode}
                display="spinner"
                themeVariant={c.background === "#151D19" ? "dark" : "light"}
                onChange={(_, date) => {
                  if (date) setDraft(date);
                }}
              />
              <Button
                title={mode === "time" ? "Use this time" : "Use this date"}
                onPress={() => {
                  change(draft);
                  setMode(null);
                }}
              />
              <Button secondary title="Cancel" onPress={() => setMode(null)} />
            </Card>
          </View>
        </Modal>
      )}
    </View>
  );
}
