import { useState } from "react";
import { View } from "react-native";
import { eventCount } from "@/lib/events";
import type { EventOccurrence } from "@/lib/models";
import { keyDate } from "@/lib/tracker";
import { EventRow } from "./event-row";
import { HeaderIconButton } from "./tab-stack";
import { dayTitle } from "./tracker-day";
import { Copy, Grouped, QuietRow } from "./ui";

/** A busy day's logs stay short here. Day has all of it, with the buttons. */
const shortList = 4;

/** The date tapped on the calendar: what's on it and what was logged, the one place to add to it, and a way to the whole day. */
export function CalendarDay({ day, today, items, known = true, logged, logs = [], onAdd, onOpen }: { day: string; today: string; items: readonly EventOccurrence[];
  /** Whether the calendar could be read in full, so an empty day can be called empty. */
  known?: boolean; logged?: string;
  /** That day's timeline rows, newest first. */
  logs?: readonly React.ReactNode[]; onAdd: () => void; onOpen?: () => void }) {
  const [all, setAll] = useState(false), line = [logged, items.length > 0 && eventCount(items.length)].filter(Boolean).join(" · ");
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Copy kind="heading">{dayTitle(day, today)}</Copy>
        {(!!line || known) && <Copy numeric kind="small" tone="muted">{line || "Nothing on the calendar"}</Copy>}
      </View>
      <HeaderIconButton icon="add" label={`Add to the calendar on ${keyDate(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`} onPress={onAdd} />
    </View>
    {items.length > 0 && <Grouped separatorInset={0}>{items.map((item) => <EventRow key={`${item.event_id}:${item.original_start}`} item={item} day={day} />)}</Grouped>}
    {logs.length > 0 && <Grouped separatorInset={0}>{all ? logs : logs.slice(0, shortList)}</Grouped>}
    {!all && logs.length > shortList && <QuietRow title={`See all ${logs.length}`} onPress={() => setAll(true)} />}
    {!!onOpen && <QuietRow title="Open this day" onPress={onOpen} />}
  </View>;
}
