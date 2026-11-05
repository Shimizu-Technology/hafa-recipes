import { View } from "react-native";
import { eventCount } from "@/lib/events";
import type { EventOccurrence } from "@/lib/models";
import { keyDate } from "@/lib/tracker";
import { EventRow } from "./event-row";
import { HeaderIconButton } from "./tab-stack";
import { dayTitle } from "./tracker-day";
import { Copy, Grouped, QuietRow } from "./ui";

/** The date tapped on the calendar: what's on it, the one place to add to it, and a way to its logs. */
export function CalendarDay({ day, today, items, logged, onAdd, onOpen }: { day: string; today: string; items: readonly EventOccurrence[]; logged?: string; onAdd: () => void; onOpen?: () => void }) {
  const line = [logged, items.length > 0 && eventCount(items.length)].filter(Boolean).join(" · ");
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Copy kind="heading">{dayTitle(day, today)}</Copy>
        <Copy numeric kind="small" tone="muted">{line || "Nothing on the calendar"}</Copy>
      </View>
      <HeaderIconButton icon="add" label={`Add to the calendar on ${keyDate(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`} onPress={onAdd} />
    </View>
    {items.length > 0 && <Grouped separatorInset={0}>{items.map((item) => <EventRow key={`${item.event_id}:${item.original_start}`} item={item} day={day} />)}</Grouped>}
    {!!onOpen && <QuietRow title="Open this day" onPress={onOpen} />}
  </View>;
}
