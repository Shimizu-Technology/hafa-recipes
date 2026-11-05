import { useState } from "react";
import { Modal, Platform, View, useColorScheme } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button, Card, Copy, useColors } from "./ui";

const asDate = (clock: string) => {
  const date = new Date();
  date.setHours(Number(clock.slice(0, 2)), Number(clock.slice(3, 5)), 0, 0);
  return date;
};
const asClock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

/** A clock time with no date, as "22:30". Like DateField's time half, and shown as this phone shows times. */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (clock: string) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(() => asDate(value)), c = useColors(), scheme = useColorScheme();
  return <View style={{ gap: 8 }}>
    <Copy kind="small">{label}</Copy>
    <Button secondary numeric title={asDate(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} accessibilityLabel={`${label} ${value}`}
      onPress={() => { setDraft(asDate(value)); setOpen(true); }} />
    {open && Platform.OS === "android" && <DateTimePicker value={draft} mode="time" onChange={(event, date) => { setOpen(false); if (event.type === "set" && date) onChange(asClock(date)); }} />}
    {open && Platform.OS !== "android" && <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end", padding: 18, paddingBottom: 36 }}>
        <Card>
          <Copy kind="heading">{label}</Copy>
          <DateTimePicker value={draft} mode="time" display="spinner" themeVariant={scheme === "dark" ? "dark" : "light"} onChange={(_, date) => { if (date) setDraft(date); }} />
          <Button title="Use this time" onPress={() => { setOpen(false); onChange(asClock(draft)); }} />
          <Button secondary title="Cancel" onPress={() => setOpen(false)} />
        </Card>
      </View>
    </Modal>}
  </View>;
}
