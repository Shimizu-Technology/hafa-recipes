import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBaby } from "@/lib/context";
import { careDays, firstCareDay, otherDayMark } from "@/lib/care-days";
import { useDeleted } from "@/lib/use-care-summary";
import { dayOverlay } from "@/lib/care-summary";
import { useEvents } from "@/lib/use-events";
import { categoryName } from "@/lib/events";
import { addDays, dayKey, keyDate, weekOf, type CareDay } from "@/lib/tracker";
import { friendlyDate } from "@/lib/care-format";
import { Copy, Icon, Notice, PressTarget, fonts, useColors } from "./ui";

const letters = ["S", "M", "T", "W", "T", "F", "S"];
const monthKey = (key: string) => key.slice(0, 7);

/** A month's grid: Sunday to Saturday, with the days around it to fill the weeks. */
export function monthGrid(month: string) {
  const first = `${month}-01`, next = keyDate(first);
  next.setMonth(next.getMonth() + 1);
  const end = dayKey(next), weeks: string[][] = [];
  for (let week = weekOf(first)[0]; keyDate(week) < keyDate(end); week = addDays(week, 7)) weeks.push(weekOf(week));
  return { weeks, from: first, to: end };
}
export function stepMonth(month: string, by: number) {
  const date = keyDate(`${month}-01`);
  date.setMonth(date.getMonth() + by);
  return monthKey(dayKey(date));
}

/** The calendar: tap a day to open it. A dot means there's something on it, and never says whether that's good. */
export function TrackerMonth({ today, day, childId, birthDate, onOpen }: { today: string; day: string; childId: string | null; birthDate?: string | null; onOpen: (key: string) => void }) {
  const b = useBaby(), c = useColors(), { fontScale } = useWindowDimensions(), timezone = b.state.bootstrap!.profile.timezone,
    [month, setMonth] = useState(monthKey(day)), [remote, setRemote] = useState<Record<string, { days: Record<string, CareDay>; others: ReadonlyMap<string, readonly string[]> }>>({}), [error, setError] = useState(false),
    [firstDay, setFirstDay] = useState<string | undefined>(undefined),
    latest = useRef(b), grid = useMemo(() => monthGrid(month), [month]), cacheKey = JSON.stringify([month, childId, b.state.bootstrap?.generation]);
  latest.current = b;
  const events = useEvents(childId, grid.weeks[0][0], grid.weeks[grid.weeks.length - 1][6]),
    // Up to three colours a day, in the order they fall. A day's category names are in its label, so colour isn't the only signal.
    kinds = (key: string) => [...new Set((events.byDay.get(key) ?? []).map((item) => item.category ?? "other"))],
    shownKinds = [...new Set(grid.weeks.flat().filter((key) => monthKey(key) === month).flatMap(kinds))];
  const gone = useDeleted(), waiting = b.state.outbox.length;
  // Coming back to the tab, and whenever a queued change leaves, because that change is now in these answers.
  useFocusEffect(useCallback(() => {
    let active = true;
    setError(false);
    void careDays(latest.current, childId, grid.weeks[0][0], grid.weeks[grid.weeks.length - 1][6], timezone, () => active)
      .then((days) => { if (active) setRemote((prior) => ({ ...prior, [cacheKey]: days })); })
      // The dots from this phone still show, and the days still open.
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [cacheKey, waiting]));
  useEffect(() => {
    let active = true;
    // Never another baby's first log, while this one's is on its way.
    setFirstDay(undefined);
    void firstCareDay(latest.current, childId, timezone).then((key) => { if (active) setFirstDay(key); }).catch(() => undefined);
    return () => { active = false; };
  }, [childId, timezone]);
  const saved = remote[cacheKey], overlay = dayOverlay(b.state, childId, timezone), other = otherDayMark(b, childId, timezone, saved?.others, gone),
    has = (key: string) => other(key) || overlay(saved?.days[key], key).dots.some((mark) => mark !== "event"),
    label = keyDate(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    jumps = [firstDay && { key: firstDay, label: "First log" }, birthDate && birthDate !== firstDay && { key: birthDate, label: "Born" }].filter(Boolean) as { key: string; label: string }[];
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <PressTarget accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(stepMonth(month, -1))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="chevron-back" size={22} color={c.text} />
      </PressTarget>
      <View style={{ flex: 1, alignItems: "center" }}><Copy kind="heading" align="center">{label}</Copy></View>
      <PressTarget accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth(stepMonth(month, 1))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="chevron-forward" size={22} color={c.text} />
      </PressTarget>
    </View>
    <View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row" }}>
        {letters.map((letter, index) => <Text key={index} allowFontScaling={false} style={{ flex: 1, textAlign: "center", fontFamily: fonts.semibold, fontSize: 12, lineHeight: 22, color: c.muted }}>{letter}</Text>)}
      </View>
      {grid.weeks.map((week) => <View key={week[0]} style={{ flexDirection: "row" }}>
        {week.map((key) => {
          const date = keyDate(key), other = monthKey(key) !== month, isToday = key === today, dot = has(key), on = kinds(key);
          return <PressTarget key={key} accessibilityRole="button" accessibilityState={{ selected: key === day }}
            accessibilityLabel={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${dot ? ", has entries" : ""}${on.length ? `, ${on.map(categoryName).join(", ")}` : ""}${isToday ? ", today" : ""}`}
            onPress={() => onOpen(key)}
            style={{ flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 2, opacity: other ? 0.5 : 1 }}>
            <View style={{ minWidth: 30, minHeight: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? c.action : "transparent" }}>
              <Text key={fontScale} maxFontSizeMultiplier={1.3} style={{ fontFamily: isToday ? fonts.semibold : fonts.medium, fontSize: 16, lineHeight: 21, fontVariant: ["tabular-nums"], color: isToday ? c.onAction : other ? c.muted : c.text }}>{date.getDate()}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 3, height: 6, alignItems: "center" }}>
              {dot && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.muted }} />}
              {on.slice(0, 3).map((kind) => <View key={kind} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.categories?.[kind] }} />)}
            </View>
          </PressTarget>;
        })}
      </View>)}
    </View>
    {shownKinds.length > 0 && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 4 }}>
      {shownKinds.map((kind) => <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.categories?.[kind] }} />
        <Text key={fontScale} maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.muted }}>{categoryName(kind)}</Text>
      </View>)}
    </View>}
    {error && <Notice>Showing what’s on this phone. Older dots will come back when you reconnect.</Notice>}
    {jumps.map((jump) => <PressTarget key={jump.label} accessibilityRole="button" accessibilityLabel={`${jump.label}, ${friendlyDate(jump.key)}`} accessibilityHint="Opens that day" onPress={() => onOpen(jump.key)}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.surface }}>
      <Icon name={jump.label === "Born" ? "heart-outline" : "flag-outline"} size={20} color={c.accentText} />
      <View style={{ flex: 1 }}>
        <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: c.text }}>{jump.label}</Text>
        <Text key={`d:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, color: c.muted, fontVariant: ["tabular-nums"] }}>{friendlyDate(jump.key)}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </PressTarget>)}
  </View>;
}
