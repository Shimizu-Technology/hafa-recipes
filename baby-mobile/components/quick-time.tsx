import { useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { zonedInstant } from "@/lib/tracker";
import { DateField } from "./date-field";
import { Icon, PressTarget, fonts, useColors } from "./ui";

/** Minutes back from now, for a log she is entering a little late. */
const presets = [["Now", 0], ["5 min ago", 5], ["15 min ago", 15], ["30 min ago", 30], ["1 hour ago", 60]] as const;
/** Times on another day, where "ago" means nothing. */
const hours = [["8 AM", 8], ["12 PM", 12], ["4 PM", 16], ["8 PM", 20], ["11 PM", 23]] as const;
/** The day being logged, when it isn't today. */
export type PastDay = { key: string; timezone?: string | null };

/** The small chip on every log, and its row of times. Today it never blocks saving, because the default is now. */
export function TimeChip({ label, open, asking, onPress }: { label: string; open: boolean; asking?: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={`Change time, ${label}`} accessibilityState={{ expanded: open }} hitSlop={8} onPress={onPress}
    style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: asking ? c.accentTint : c.soft, borderWidth: asking ? 1 : 0, borderColor: c.accent }}>
      <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: asking ? c.accentText : c.text, fontVariant: ["tabular-nums"] }}>{label}</Text>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={13} color={c.muted} />
    </View>
  </PressTarget>;
}

export function TimeChoices({ value, onChange, now = new Date(), day, timeZone }: { value: string; onChange: (iso: string | null) => void; now?: Date; day?: PastDay; timeZone?: string | null }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [picking, setPicking] = useState(false);
  return <View style={{ gap: 8 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
      {day ? hours.map(([label, hour]) => <PressTarget key={label} accessibilityRole="button" accessibilityLabel={label}
        onPress={() => onChange(zonedInstant(day.key, hour, 0, day.timezone).toISOString())}
        style={{ minHeight: 56, paddingHorizontal: 16, borderRadius: 16, justifyContent: "center", backgroundColor: c.soft }}>
        <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: c.text }}>{label}</Text>
      </PressTarget>) : presets.map(([label, minutes]) => <PressTarget key={label} accessibilityRole="button" accessibilityLabel={label}
        onPress={() => onChange(minutes ? new Date(now.getTime() - minutes * 60_000).toISOString() : null)}
        style={{ minHeight: 56, paddingHorizontal: 16, borderRadius: 16, justifyContent: "center", backgroundColor: c.soft }}>
        <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: c.text }}>{label}</Text>
      </PressTarget>)}
      <PressTarget accessibilityRole="button" accessibilityLabel="Pick a time" accessibilityState={{ expanded: picking }} onPress={() => setPicking(!picking)}
        style={{ minHeight: 56, paddingHorizontal: 16, borderRadius: 16, justifyContent: "center", backgroundColor: c.soft }}>
        <Text key={`p:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: c.text }}>Pick a time</Text>
      </PressTarget>
    </ScrollView>
    {picking && <DateField label="Date and time" value={value} timeZone={timeZone ?? day?.timezone} onChange={(iso) => iso && onChange(iso)} />}
  </View>;
}
