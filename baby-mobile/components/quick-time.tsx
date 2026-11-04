import { useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { DateField } from "./date-field";
import { Icon, PressTarget, fonts, useColors } from "./ui";

/** Minutes back from now, for a log she is entering a little late. */
const presets = [["Now", 0], ["5 min ago", 5], ["15 min ago", 15], ["30 min ago", 30], ["1 hour ago", 60]] as const;

/** The small chip on every log, and its row of times. It never blocks saving: the default is now. */
export function TimeChip({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={`Change time, ${label}`} accessibilityState={{ expanded: open }} hitSlop={8} onPress={onPress}
    style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: c.soft }}>
      <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: c.text, fontVariant: ["tabular-nums"] }}>{label}</Text>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={13} color={c.muted} />
    </View>
  </PressTarget>;
}

export function TimeChoices({ value, onChange, now = new Date() }: { value: string; onChange: (iso: string | null) => void; now?: Date }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [picking, setPicking] = useState(false);
  return <View style={{ gap: 8 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
      {presets.map(([label, minutes]) => <PressTarget key={label} accessibilityRole="button" accessibilityLabel={label}
        onPress={() => onChange(minutes ? new Date(now.getTime() - minutes * 60_000).toISOString() : null)}
        style={{ minHeight: 44, paddingHorizontal: 13, borderRadius: 16, justifyContent: "center", backgroundColor: c.soft }}>
        <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: c.text }}>{label}</Text>
      </PressTarget>)}
      <PressTarget accessibilityRole="button" accessibilityLabel="Pick a time" accessibilityState={{ expanded: picking }} onPress={() => setPicking(!picking)}
        style={{ minHeight: 44, paddingHorizontal: 13, borderRadius: 16, justifyContent: "center", backgroundColor: c.soft }}>
        <Text key={`p:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: c.text }}>Pick a time</Text>
      </PressTarget>
    </ScrollView>
    {picking && <DateField label="Date and time" value={value} onChange={(iso) => iso && onChange(iso)} />}
  </View>;
}
