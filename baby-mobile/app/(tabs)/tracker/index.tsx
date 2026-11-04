import { useEffect, useState } from "react";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { careLogsStarted, profileToday, timingChild, todayStage } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { dayKey, dayRange, summaryLine, keyDate, addDays, onDay, timelineKinds, weekOf } from "@/lib/tracker";
import { dayOverlay } from "@/lib/care-summary";
import { otherDayMark } from "@/lib/care-days";
import { useCareSummary, useDeleted, useOtherDays } from "@/lib/use-care-summary";
import { newestFirst } from "@/lib/feed-reducer";
import { Copy, Empty, FilterChips, Grouped, Icon, Notice, PressTarget, Row, Screen, useColors } from "@/components/ui";
import { HeaderPill } from "@/components/tab-stack";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { useMinuteClock } from "@/components/care-glance";
import { QuickLog } from "@/components/quick-log";
import { LegacyTimer } from "@/components/feed-timer";
import { OrderToggle, TimelineRow, WeekStrip, dayTitle } from "@/components/tracker-day";
import { TrackerMonth } from "@/components/tracker-month";
import { TrackerStats } from "@/components/tracker-stats";
import { useCareStats } from "@/lib/use-care-stats";
import type { StatsChoice } from "@/lib/care-stats";

/** The docked log covers too much of the screen at the largest text sizes, so it scrolls with the page there. */
const dockBelow = 1.5;

export default function Tracker() {
  const b = useBaby(), c = useColors(), now = useMinuteClock(), params = useLocalSearchParams<{ day?: string; at?: string }>(),
    timezone = b.state.bootstrap!.profile.timezone,
    today = dayKey(profileToday(now, timezone)),
    [picked, setPicked] = useState<string | null>(null),
    [newest, setNewest] = useState(true),
    [chosenView, setView] = useState<string | null>(null),
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
    // Before the birth there's nothing to log by the day yet, so she lands on the calendar and the tools.
    view = chosenView ?? (expecting ? "month" : "day"),
    stats = useCareStats(view === "stats" ? statsChoice : null, scope),
    summary = useCareSummary(scope, strip[0], strip[strip.length - 1], { poll: day === today }),
    others = useOtherDays(scope, strip[0], strip[strip.length - 1]),
    gone = useDeleted(),
    other = otherDayMark(b, scope, timezone, others, gone),
    overlay = dayOverlay(b.state, scope, timezone, now),
    rows = care.all.filter((row) => onDay(row, day, timezone, now)).sort((x, y) => (newest ? 1 : -1) * newestFirst(x, y)),
    future = keyDate(day) > keyDate(today),
    { fontScale } = useWindowDimensions(),
    marked = new Set(strip.filter((key) => other(key) || overlay(summary?.[key], key).dots.length > 0));
  useEffect(() => {
    // A link to one day, from Today or the calendar.
    if (params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day)) { setPicked(params.day === today ? null : params.day); setView("day"); }
  }, [params.day, params.at]);
  const pick = (key: string) => setPicked(key === today ? null : key),
    quickLog = logging && !future ? <QuickLog key={day} child={child!} rows={recent.all} now={now} pastDay={day === today ? undefined : { key: day, timezone }} /> : null;
  return (
    <Screen title="Tracker" onRefresh={() => Promise.all([care.refresh(), recent.refresh(), stats.refresh()])} footer={fontScale < dockBelow && view === "day" ? quickLog : undefined}>
      <Stack.Screen options={{ title: "Tracker" }} />
      <SyncStatus />
      {children.length > 1 && <ChildFilter only={scope ?? undefined} />}
      <FilterChips label="Tracker view" value={view} onChange={setView} options={[{ label: "Day", value: "day" }, { label: "Calendar", value: "month" }, { label: "Stats", value: "stats" }]} />
      {expecting && view !== "stats" && <Grouped>
        <Row title="Contraction timer" detail="Start, stop, and the last hour" icon="pulse-outline" onPress={() => router.push("/contractions")} />
        <Row title="Kick counter" detail="A tap for each movement, and your history" icon="footsteps-outline" onPress={() => router.push("/kicks")} />
      </Grouped>}
      {view === "month" ? <TrackerMonth today={today} day={day} childId={scope} birthDate={child?.birth_date}
        onOpen={(key) => { pick(key); setView("day"); }} /> : view === "stats" ? <TrackerStats answer={stats} choice={statsChoice} onChoose={setStatsChoice} today={today} childId={scope} expecting={expecting} now={now}
        onOpen={(key) => { pick(key); setView("day"); }} /> : <>
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
        {!future && <Copy numeric kind="small" tone="muted">{summaryLine(overlay(summary?.[day], day))}</Copy>}
      </View>
      {day === today && <LegacyTimer />}
      {!!care.error && <Notice>Showing what’s on this phone. {care.error}</Notice>}
      {fontScale >= dockBelow && quickLog}
      {rows.length ? <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Copy kind="small" tone="muted">Everything, in order</Copy>
          <OrderToggle newest={newest} onFlip={() => setNewest(!newest)} />
        </View>
        <Grouped separatorInset={0}>{rows.map((row) => (
          <TimelineRow key={row.id} record={row} rows={care.all} day={day} timeZone={timezone} now={now} pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === row.id)} />
        ))}</Grouped>
      </View> : <Empty icon="calendar-outline" title={future ? "Nothing planned yet" : "Nothing logged this day"}
        body={future ? "This day is still ahead." : logging ? "Tap a button below to add one." : "Feeds, sleep and diapers will show here once the baby’s here."} />}
      </>}
      <Grouped>
        <Row title="Care history" detail="Search all care logs" icon="time-outline" onPress={() => router.push("/care-history")} />
      </Grouped>
    </Screen>
  );
}
