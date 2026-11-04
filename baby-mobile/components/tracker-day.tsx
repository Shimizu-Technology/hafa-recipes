import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { careSummary } from "@/lib/care-format";
import { kindName, type BabyRecord } from "@/lib/models";
import { feedProgress } from "@/lib/feed-reducer";
import { addDays, clockIn, keyDate, recordDay, weekOf } from "@/lib/tracker";
import { Icon, PressTarget, fonts, radii, typeScale, useColors } from "./ui";
import { contractionDetail } from "@/lib/contractions";
import { kickDetail } from "@/lib/kicks";
import { datedOnly } from "../lib/well-visits";
import { recordIcon } from "./record-row";

const letters = ["S", "M", "T", "W", "T", "F", "S"];
/** Weeks either side of the one on screen, one swipe apart. */
const reach = 6;

/** One tap to any recent day: seven days to a page, with a dot on days that have something. */
export function WeekStrip({ day, today, marked, onPick }: { day: string; today: string; marked: ReadonlySet<string>; onPick: (key: string) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), scroller = useRef<ScrollView>(null), [width, setWidth] = useState(0),
    selected = weekOf(day)[0], thisWeek = weekOf(today)[0],
    first = keyDate(selected) < keyDate(addDays(thisWeek, -7 * reach)) ? selected : addDays(thisWeek, -7 * reach),
    last = keyDate(selected) > keyDate(addDays(thisWeek, 7 * reach)) ? selected : addDays(thisWeek, 7 * reach),
    weeks: string[] = [];
  for (let week = first; keyDate(week) <= keyDate(last); week = addDays(week, 7)) weeks.push(week);
  const page = weeks.indexOf(selected);
  useEffect(() => {
    if (width) scroller.current?.scrollTo({ x: page * width, animated: false });
  }, [page, width]);
  return <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    accessibilityRole="adjustable" accessibilityLabel="Week">
    {weeks.map((week) => <View key={week} style={{ width: width || undefined, flexDirection: "row", gap: 2 }}>
      {weekOf(week).map((key, index) => {
        const on = key === day, date = keyDate(key), future = keyDate(key) > keyDate(today), has = marked.has(key);
        return <PressTarget key={key} accessibilityRole="button" accessibilityState={{ selected: on }}
          accessibilityLabel={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${has ? ", has entries" : ""}${key === today ? ", today" : ""}`}
          onPress={() => onPick(key)}
          style={{ flex: 1, minHeight: 66, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 1, backgroundColor: on ? c.action : "transparent" }}>
          <Text allowFontScaling={false} style={{ fontFamily: fonts.semibold, fontSize: 11, lineHeight: 13, color: on ? c.onAction : c.muted }}>{letters[index]}</Text>
          <Text key={fontScale} maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, fontVariant: ["tabular-nums"],
            color: on ? c.onAction : key === today ? c.accentText : future ? c.muted : c.text }}>{date.getDate()}</Text>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: has ? (on ? c.onAction : c.accent) : "transparent" }} />
        </PressTarget>;
      })}
    </View>)}
  </ScrollView>;
}

const timeOf = (iso: string, timeZone?: string | null) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : clockIn(date, timeZone);
};

/** The second line of a timeline row: what the title doesn't already say. */
export function timelineDetail(record: BabyRecord, { rows = [record], day, timeZone, now = new Date() }: { rows?: readonly BabyRecord[]; day?: string; timeZone?: string | null; now?: Date } = {}) {
  const carried = !!day && record.kind === "sleep" && recordDay(record.occurred_at, timeZone) !== day ? "Began the day before" : "";
  if (record.kind === "sleep" && record.data.end_at) return [carried, `${timeOf(record.occurred_at, timeZone)} to ${timeOf(record.data.end_at, timeZone)}`].filter(Boolean).join(" · ");
  if (carried) return carried;
  const progress = record.kind === "feeding" ? feedProgress(record, rows, now) : undefined;
  if (progress === "running") return "Feeding now";
  if (progress === "no_end") return "No end time";
  if (record.kind === "contraction") return contractionDetail(record, now);
  if (record.kind === "kick_session") return kickDetail(record, now);
  return record.body.trim().split("\n")[0] ?? "";
}

/** One thing that happened: when, what, and a way in to change it. */
export function TimelineRow({ record, rows, day, timeZone, pending, now }: { record: BabyRecord; rows?: readonly BabyRecord[]; day?: string; timeZone?: string | null; pending?: boolean; now: Date }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), when = datedOnly(record) ? "" : timeOf(record.occurred_at, timeZone), stacked = fontScale >= 1.5,
    summary = careSummary(record.kind, record.data, record.occurred_at, now, timeZone),
    title = summary || (record.data.label ?? kindName[record.kind]),
    detail = [timelineDetail(record, { rows, day, timeZone, now }) || (summary || record.title === title ? "" : record.title), pending ? "Saved on this phone" : ""].filter(Boolean).join(" · ");
  return <PressTarget accessibilityRole="button" accessibilityLabel={`${when ? `${when}, ` : ""}${title}${detail ? `. ${detail}` : ""}`} accessibilityHint="Opens this entry to change it"
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: stacked ? 4 : 10, minHeight: 62, paddingVertical: 9, paddingLeft: 14, paddingRight: 12, backgroundColor: c.surface }}>
    {!!when && <Text key={`w:${fontScale}`} maxFontSizeMultiplier={0} style={{ width: stacked ? undefined : Math.ceil(66 * Math.min(fontScale, 1.5)), ...typeScale.caption, fontSize: 13, lineHeight: 18, color: c.muted, fontVariant: ["tabular-nums"] }}>{when}</Text>}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: stacked ? undefined : 1, minWidth: 0, alignSelf: stacked ? "stretch" : undefined }}>
      <View style={{ width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: c.tile }}>
        <Icon name={recordIcon(record)} size={19} color={c.accentText} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text key={`t:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: c.text, fontVariant: ["tabular-nums"] }}>{title}</Text>
        {!!detail && <Text key={`d:${fontScale}`} numberOfLines={1} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, fontSize: 13, lineHeight: 17, color: c.muted, fontVariant: ["tabular-nums"] }}>{detail}</Text>}
      </View>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </View>
  </PressTarget>;
}

/** Newest first, or flipped. */
export function OrderToggle({ newest, onFlip }: { newest: boolean; onFlip: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={newest ? "Newest first" : "Oldest first"} accessibilityHint="Flips the order" onPress={onFlip}
    style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.field }}>
    <Icon name="swap-vertical" size={15} color={c.muted} />
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: c.muted }}>{newest ? "Newest first" : "Oldest first"}</Text>
  </PressTarget>;
}

export const dayTitle = (key: string, today: string) => key === today ? "Today" : key === addDays(today, -1) ? "Yesterday"
  : keyDate(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
