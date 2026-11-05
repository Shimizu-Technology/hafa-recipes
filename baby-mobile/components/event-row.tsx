import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { eventClock, eventKindName, eventWhen, nextEvent } from "@/lib/events";
import type { EventCategory, EventOccurrence } from "@/lib/models";
import { useUpcomingEvents } from "@/lib/use-events";
import { NextVisitQuestions, type useVisitDrafts } from "./visit-sections";
import { Copy, Grouped, Icon, PressTarget, Row, fonts, typeScale, useColors, type IconName } from "./ui";

const categoryIcon: Record<EventCategory, IconName> = { appointment: "medkit-outline", family: "people-outline", celebration: "gift-outline",
  milestone: "flag-outline", reminder: "notifications-outline", other: "calendar-outline" };
export const openEvent = (item: EventOccurrence) => router.push({ pathname: "/event/[id]", params: { id: item.event_id, at: item.original_start } });

/** An event's category at a glance: its own colour, and its own glyph for anyone who can't tell the colours apart. */
export function CategoryTile({ category, size = 36 }: { category?: EventCategory | null; size?: number }) {
  const c = useColors(), kind = category ?? "other";
  return <View style={{ width: size, height: size, borderRadius: size * 0.36, alignItems: "center", justifyContent: "center", backgroundColor: c.tile }}>
    <Icon name={categoryIcon[kind]} size={size * 0.53} color={c.categories?.[kind]} />
  </View>;
}
/** An event among the logs on a day's timeline. */
export function EventRow({ item, day }: { item: EventOccurrence; day: string }) {
  const b = useBaby(), c = useColors(), { fontScale } = useWindowDimensions(), when = eventClock(item, day, b.state.bootstrap?.profile.timezone), stacked = fontScale >= 1.5,
    detail = [eventKindName(item), item.location].filter(Boolean).join(" · ");
  return <PressTarget accessibilityRole="button" accessibilityLabel={[`${when}, ${item.title}`, detail].filter(Boolean).join(". ")} accessibilityHint="Opens this event" onPress={() => openEvent(item)}
    style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: stacked ? 4 : 10, minHeight: 62, paddingVertical: 9, paddingLeft: 14, paddingRight: 12, backgroundColor: c.surface }}>
    <Text key={`w:${fontScale}`} maxFontSizeMultiplier={0} style={{ width: stacked ? undefined : Math.ceil(66 * Math.min(fontScale, 1.5)), ...typeScale.caption, fontSize: 13, lineHeight: 18, color: c.muted, fontVariant: ["tabular-nums"] }}>{when}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: stacked ? undefined : 1, minWidth: 0, alignSelf: stacked ? "stretch" : undefined }}>
      <CategoryTile category={item.category} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text key={`t:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: c.text }}>{item.title}</Text>
        {!!detail && <Text key={`d:${fontScale}`} numberOfLines={1} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, fontSize: 13, lineHeight: 17, color: c.muted }}>{detail}</Text>}
      </View>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </View>
  </PressTarget>;
}
const EventListRow = ({ item, today, timeZone }: { item: EventOccurrence; today: string; timeZone?: string | null }) =>
  <Row numericDetail title={item.title} detail={[eventWhen(item, today, timeZone), item.location].filter(Boolean).join(" · ")} leading={<CategoryTile category={item.category} size={44} />}
    hint="Opens this event" onPress={() => openEvent(item)} />;

/** Next on the calendar, under the month. */
export function ComingUp({ childId, today }: { childId: string | null; today: string }) {
  const b = useBaby(), timeZone = b.state.bootstrap?.profile.timezone, { items } = useUpcomingEvents(childId, today), now = new Date(),
    next = nextEvent(items, now, timeZone), list = next ? items.slice(items.indexOf(next), items.indexOf(next) + 4) : [];
  return list.length ? <View style={{ gap: 8 }}>
    <Copy kind="heading">Coming up</Copy>
    <Grouped>{list.map((item) => <EventListRow key={`${item.event_id}:${item.original_start}`} item={item} today={today} timeZone={timeZone} />)}</Grouped>
  </View> : null;
}
/** The next thing on the calendar, or the way to add one. It's on Today before and after the birth. */
export function NextEvent({ childId, today, now, drafts, quiet }: { childId: string | null; today: string; now: Date; drafts: ReturnType<typeof useVisitDrafts>;
  /** With nothing coming up, say nothing: Add has the calendar. */
  quiet?: boolean }) {
  const b = useBaby(), timeZone = b.state.bootstrap?.profile.timezone, { items } = useUpcomingEvents(childId, today), next = nextEvent(items, now, timeZone);
  const appointment = next?.category === "appointment";
  if (!next && quiet) return null;
  if (!next) return <Row title="Add to the calendar" detail="A visit, a birthday, anything with a date" icon="calendar-outline"
    onPress={() => router.push({ pathname: "/edit", params: { kind: "event", day: today } })} />;
  return <View style={{ gap: 8 }}>
    <Copy kind="label" tone="muted">Next up</Copy>
    <EventListRow item={next} today={today} timeZone={timeZone} />
    <NextVisitQuestions items={items} separate={!appointment} drafts={drafts} />
  </View>;
}
