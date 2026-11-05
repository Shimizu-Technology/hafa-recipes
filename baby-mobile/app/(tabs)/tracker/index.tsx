import { useEffect, useRef, useState } from "react";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { careLogsStarted, profileToday, timingChild, todayStage, trackerStage } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { dayKey, dayRange, summaryLine, keyDate, addDays, onDay, timelineKinds, weekOf } from "@/lib/tracker";
import { dayOverlay } from "@/lib/care-summary";
import { otherDayMark } from "@/lib/care-days";
import { useCareSummary, useDeleted, useOtherDays } from "@/lib/use-care-summary";
import { newestFirst } from "@/lib/feed-reducer";
import { useEvents } from "@/lib/use-events";
import { dayTimeline, eventCount } from "@/lib/events";
import { Button, Copy, Empty, Grouped, Icon, Notice, PressTarget, QuietRow, Screen, Segmented, useColors } from "@/components/ui";
import { ComingUp, EventRow } from "@/components/event-row";
import { HeaderPill } from "@/components/tab-stack";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { useMinuteClock } from "@/components/care-glance";
import { QuickLog } from "@/components/quick-log";
import { MoreLogs } from "@/components/more-logs";
import { loggableWords, panelTrackers, trackerOn, trackersFor, trackingKey } from "../../../lib/trackers";
import { LegacyTimer } from "@/components/feed-timer";
import { OrderToggle, TimelineRow, WeekStrip, dayTitle } from "@/components/tracker-day";
import { familyLine } from "../../../lib/logged-by";
import { canChangeBaby } from "../../../lib/spaces";
import { TrackerMonth } from "@/components/tracker-month";
import { CalendarDay } from "@/components/calendar-day";
import { TrackerStats } from "@/components/tracker-stats";
import { useCareStats } from "@/lib/use-care-stats";
import type { StatsChoice } from "@/lib/care-stats";

/** The docked log covers too much of the screen at the largest text sizes, so it scrolls with the page there. */
const dockBelow = 1.5;

export default function Tracker() {
  const [moreOpen, setMoreOpen] = useState(false);
  const b = useBaby(), c = useColors(), now = useMinuteClock(), params = useLocalSearchParams<{ day?: string; at?: string }>(),
    timezone = b.state.bootstrap!.profile.timezone,
    today = dayKey(profileToday(now, timezone)),
    [picked, setPicked] = useState<string | null>(null),
    [newest, setNewest] = useState(true),
    [chosenView, setView] = useState<string | null>(null),
    scroller = useRef<ScrollView>(null),
    // Kept here, so opening a day from a bar and coming back finds the same range.
    [statsChoice, setStatsChoice] = useState<StatsChoice>({ range: "7d" }),
    day = picked ?? today,
    range = dayRange(day, timezone),
    child = timingChild(b.state, keyDate(today)),
    // Tracker is always about one baby: the timeline, totals, dots and logging all use this.
    scope = child?.id ?? null,
    // A day looks back one more, for a sleep that ran over midnight into it.
    care = useTodayCare({ kinds: timelineKinds, occurred_from: dayRange(addDays(day, -1), timezone).from, occurred_to: range.to, pages: 5, limit: 500, poll: day === today, child: scope }),
    recent = useTodayCare({ child: scope }),
    // The weeks a swipe away, so their dots are already there.
    strip = Array.from({ length: 90 }, (_, index) => addDays(weekOf(day)[0], index - 42)),
    children = b.state.bootstrap!.children,
    logging = careLogsStarted(children, keyDate(today)) && !!child && todayStage(child, keyDate(today)) === "baby",
    expecting = !!child && !logging && todayStage(child, keyDate(today)) !== "none",
    stage = child ? trackerStage(child, keyDate(today)) : "born",
    onNow = child ? trackersFor(stage).filter((tracker) => trackerOn(tracker, stage, child.details)) : [],
    // Add logs today, so another day keeps a way to log the rest, short of what she's turned off.
    moreShown = day !== today ? panelTrackers(stage).filter((tracker) => child?.details?.tracking?.[trackingKey(tracker.id, stage)] !== false)
      : onNow.filter((tracker) => tracker.opens !== "quick-log" || !logging),
    // Before the birth she lands on the calendar. Day has what she can log, Today and Add have it too.
    view = chosenView ?? (expecting ? "month" : "day"),
    stats = useCareStats(view === "stats" ? statsChoice : null, scope),
    summary = useCareSummary(scope, strip[0], strip[strip.length - 1], { poll: day === today }),
    others = useOtherDays(scope, strip[0], strip[strip.length - 1]),
    gone = useDeleted(),
    other = otherDayMark(b, scope, timezone, others, gone),
    overlay = dayOverlay(b.state, scope, timezone, now),
    rows = care.all.filter((row) => onDay(row, day, timezone, now)).sort((x, y) => (newest ? 1 : -1) * newestFirst(x, y)),
    future = keyDate(day) > keyDate(today),
    // Counts only what has a button, as Today's line does: a tracker switched off stays in the list below and in Stats.
    shown = (...ids: string[]) => onNow.some((tracker) => ids.includes(tracker.id)),
    dayWords = summaryLine(overlay(summary?.[day], day), { feeds: shown("breast", "bottle"), diapers: shown("diaper"), sleep: shown("sleep") }),
    { fontScale } = useWindowDimensions(),
    events = useEvents(scope, strip[0], strip[strip.length - 1]),
    dayEvents = events.byDay.get(day) ?? [],
    // Event dots come from `useEvents`, which knows what's queued. The summary's own only knows what's saved.
    marked = new Set(strip.filter((key) => other(key) || events.byDay.has(key) || overlay(summary?.[key], key).dots.some((dot) => dot !== "event"))),
    timeline = dayTimeline(rows, dayEvents, newest);
  useEffect(() => {
    // A link to one day, from Today or the calendar.
    if (params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day)) { setPicked(params.day === today ? null : params.day); setView("day"); }
  }, [params.day, params.at]);
  const addEvent = (key: string) => router.push({ pathname: "/edit", params: { kind: "event", day: key } }),
    pick = (key: string) => setPicked(key === today ? null : key),
    blank = (() => {
      if (future) return { title: "Nothing planned yet", body: "This day is still ahead. The calendar is where to add to it.", action: <HeaderPill title="Open the calendar" onPress={() => setView("month")} /> };
      const title = day === today ? "Nothing logged today" : "Nothing logged this day";
      if (logging) return { title: "Nothing logged this day", body: "Tap a button below to add one." };
      if (expecting) return { title, body: moreShown.length ? `You can log ${loggableWords(moreShown)}. Tap one below.` : "Nothing is switched on to log. What shows has the list." };
      if (child) return { title, body: "Add a due date or a birth date, and what you can log will show here.", action: <Button secondary title="Add a date" onPress={() => router.push({ pathname: "/child", params: { id: child.id } })} /> };
      return { title, body: "Set up your baby, and what you can log will show here.", action: <Button secondary title="Set up your baby" onPress={() => router.push("/child")} /> };
    })(),
    quickLog = logging && !future ? <QuickLog key={day} child={child!} rows={recent.all} now={now} pastDay={day === today ? undefined : { key: day, timezone }} tilesAside={moreOpen} tiles={onNow.filter((tracker) => tracker.opens === "quick-log")} /> : null;
  return (
    <Screen title="Tracker" scrollRef={scroller} onRefresh={() => Promise.all([care.refresh(), recent.refresh(), stats.refresh()])} footer={fontScale < dockBelow && view === "day" ? quickLog : undefined}>
      <Stack.Screen options={{ title: "Tracker" }} />
      <SyncStatus />
      {children.length > 1 && <ChildFilter only={scope ?? undefined} />}
      <Segmented label="Tracker view" value={view} onChange={setView} options={[{ label: "Day", value: "day" }, { label: "Calendar", value: "month" }, { label: "Stats", value: "stats" }]} />
      {view === "month" ? <>
        <TrackerMonth today={today} day={day} childId={scope} birthDate={child?.birth_date} onPick={pick} onOpen={(key) => { pick(key); setView("day"); }}>
          <CalendarDay day={day} today={today} items={dayEvents} logged={future ? undefined : dayWords} onAdd={() => addEvent(day)} onOpen={future ? undefined : () => { setView("day"); scroller.current?.scrollTo({ y: 0, animated: false }); }} />
        </TrackerMonth>
        <ComingUp childId={scope} today={today} except={dayEvents} />
      </> : view === "stats" ? <TrackerStats answer={stats} choice={statsChoice} onChoose={setStatsChoice} today={today} childId={scope} expecting={expecting} now={now} growth={logging}
        // A bar can be far down the page, and the day has to start at its own title.
        onOpen={(key) => { pick(key); setView("day"); scroller.current?.scrollTo({ y: 0, animated: false }); }} /> : <>
      <WeekStrip day={day} today={today} marked={marked} onPick={pick} />
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
          <View style={{ flexShrink: 1 }}><Copy kind="heading">{dayTitle(day, today)}</Copy></View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {day !== today && <HeaderPill title="Back to today" onPress={() => pick(today)} />}
            <PressTarget accessibilityRole="button" accessibilityLabel="Day before" onPress={() => pick(addDays(day, -1))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Icon name="chevron-back" size={22} color={c.text} />
            </PressTarget>
            <PressTarget accessibilityRole="button" accessibilityLabel="Day after" onPress={() => pick(addDays(day, 1))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Icon name="chevron-forward" size={22} color={c.text} />
            </PressTarget>
          </View>
        </View>
        {((!future && !!dayWords) || dayEvents.length > 0) && <Copy numeric kind="small" tone="muted">{[!future && dayWords, dayEvents.length > 0 && eventCount(dayEvents.length)].filter(Boolean).join(" · ")}</Copy>}
      </View>
      {day === today && <LegacyTimer />}
      {!!care.error && b.online !== false && !b.unreachable && <Notice>Showing what’s on this phone. {care.error}</Notice>}
      {fontScale >= dockBelow && quickLog}
      {timeline.length ? <View style={{ gap: 4 }}>
        {/* Wraps as a whole at the largest text, rather than breaking mid-word beside the toggle. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <Copy kind="small" tone="muted">Everything, in order</Copy>
          <OrderToggle newest={newest} onFlip={() => setNewest(!newest)} />
        </View>
        <Grouped separatorInset={0}>{timeline.map((entry) => "event_id" in entry
          ? <EventRow key={`${entry.event_id}:${entry.original_start}`} item={entry} day={day} />
          : <TimelineRow key={entry.id} record={entry} rows={care.all} day={day} timeZone={timezone} now={now} logged={familyLine(entry, care.all, b.state.bootstrap, b.owner)} pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === entry.id)} />
        )}</Grouped>
      </View> : <Empty icon="calendar-outline" {...blank} />}
      {(logging || expecting) && !future && <MoreLogs key={`more:${day}`} child={child!} now={now} shown={moreShown} title={logging ? undefined : day === today ? "Log now" : "Add to this day"} pastDay={day === today ? undefined : { key: day, timezone }} onOpen={(open, y) => { setMoreOpen(open); if (open) scroller.current?.scrollTo({ y, animated: true }); }} />}
      {/* The logs, searched across every day. Today has it too. */}
      <View>
        <QuietRow title="Care history" onPress={() => router.push("/care-history")} />
        {!!child && canChangeBaby(b.state.bootstrap, child) && <QuietRow title="What shows" onPress={() => router.push({ pathname: "/what-shows", params: { child: child.id } })} />}
      </View>
      </>}
    </Screen>
  );
}
