import { useRef } from "react";
import { Stack, router } from "expo-router";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { useTodayCare } from "@/lib/today-care";
import { sleepGlanceDetail, babyAge, careGlance } from "@/lib/care-glance";
import { routineToday, routineReminderLabel } from "@/lib/today-routines";
import { activeTimer } from "@/lib/feed-timer";
import { runningFeed } from "@/lib/feed-reducer";
import { dayKey, summaryLine } from "@/lib/tracker";
import { dayOverlay } from "@/lib/care-summary";
import { useCareSummary } from "@/lib/use-care-summary";
import { babyArrived } from "@/lib/quick-care";
import { messageFor } from "@/lib/models";
import { Button, Card, Copy, Grouped, PressTarget, Icon, Notice, Row, Screen, radii, tap, typeScale, useColors, useToast, type IconName } from "@/components/ui";
import { kindIcon } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { DueReminders } from "@/components/due-reminders";
import { CareGlance, useMinuteClock } from "@/components/care-glance";
import { BabySetupCard } from "@/components/stage-options";
import { canAddBaby, canChangeBaby } from "../../../lib/spaces";
import { LegacyTimer } from "@/components/feed-timer";
import { QuickLog } from "@/components/quick-log";
import { MoreLogs } from "@/components/more-logs";
import { TrackerSuggestion } from "@/components/tracker-suggestion";
import { trackerOn, trackersFor } from "../../../lib/trackers";
import { BabyAgeCard, PregnancyHero, TipSection, WeekDetails } from "@/components/tips";
import { NextEvent } from "@/components/event-row";
import { useVisitDrafts } from "@/components/visit-sections";
import { dueLine, profileToday, timingChild, todayStage, trackerStage } from "@/lib/timing";
import { useTimingTips } from "@/lib/use-timing-tips";
import { journalHome } from "../../../lib/use-open-journal";

/** The docked log covers too much of the screen at the largest text sizes, so it scrolls with the page there. */
const dockBelow = 1.5;

export default function Today() {
  const scroller = useRef<ScrollView>(null);
  const b = useBaby(), c = useColors(),
    toast = useToast(),
    now = useMinuteClock(),
    // Here, because a baby who's due and one who's born each get their own layout, and a half-typed question outlasts both.
    visitDrafts = useVisitDrafts(),
    { fontScale } = useWindowDimensions(),
    children = b.state.bootstrap!.children,
    // The profile's calendar day, as the API counts pregnancy weeks and baby age.
    today = profileToday(now, b.state.bootstrap!.profile.timezone),
    child = timingChild(b.state, today),
    records = b.records.filter((r) => !r.child_id || r.child_id === child?.id),
    latestCare = useTodayCare(),
    glance = careGlance(latestCare.all, child?.id ?? null, now, b.state.bootstrap!.profile.timezone),
    routines = records.filter((r) => routineToday(r, now)),
    stage = todayStage(child, today),
    pregnant = stage === "pregnancy",
    expecting = pregnant || stage === "needs_birth",
    // A named baby with no date could be either stage, so care only stays for one who already has some logged.
    showCare = !!child && !expecting && (stage !== "none" || latestCare.all.some((row) => row.child_id === child.id)),
    tipsNow = useTimingTips(child, "now", 5, today),
    tipsNext = useTimingTips(pregnant ? child : null, "upcoming", 3, today),
    // A device timer is from an older build: it finishes the old way, on its own card, and is gone.
    timer = activeTimer(b.state),
    running = runningFeed(latestCare.all, child?.id ?? null, now),
    timezone = b.state.bootstrap!.profile.timezone,
    todayKey = dayKey(today),
    summary = useCareSummary(child?.id ?? null, todayKey, todayKey, { poll: true });
  const sleepEntry = glance.openSleep ?? glance.lastSleep,
    sleepTitle = glance.openSleeps.length > 1 ? `${glance.openSleeps.length} sleeps running` : glance.openSleep ? "Sleeping now" : glance.lastSleep ? "Awake" : "Sleep",
    sleepDetail = sleepGlanceDetail(glance, now),
    routine = routines[0],
    trackerAge = child ? trackerStage(child, today) : "born",
    // A sleep already running keeps its button until it's ended, switched off or not.
    tiles = child ? trackersFor(trackerAge).filter((tracker) => trackerOn(tracker, trackerAge, child.details) || (tracker.id === "sleep" && !!glance.openSleep)) : [],
    showing = (...ids: string[]) => tiles.some((tracker) => ids.includes(tracker.id)),
    parentHere = child ? canChangeBaby(b.state.bootstrap, child) : canAddBaby(b.state.bootstrap),
    whatShows = child && parentHere && <Row title="What shows" detail="Everything’s off. Choose what gets a button." icon="options-outline" onPress={() => router.push({ pathname: "/what-shows", params: { child: child.id } })} />,
    // The same quiet two rows before and after the birth, so her writing never moves.
    keptRows = [
      <Row key="routines" numericDetail title={routine?.title || "Lists & routines"}
        detail={routine?.data.reminder_at ? routineReminderLabel(routine) : routine ? "Your next checklist · Lists & routines" : "Checklists, chosen plans and reminders"}
        icon="checkmark-circle-outline" onPress={() => router.push("/routines")} />,
      <Row key="journal" title="Journal" detail="Your entries and doctor questions" icon="book-outline" onPress={() => router.navigate(journalHome())} />,
    ];
  const titleText = child?.name.trim() || "Today";
  const addBirth = () => child && router.push({ pathname: "/child", params: { id: child.id, stage: "here" } });
  /** One tap, since it may be the only hand free. Settings changes the date if it was another day. */
  async function arrived() {
    if (!child) return;
    try {
      const undo = await babyArrived(b, child, dayKey(today));
      tap("success");
      toast("Birth date set to today. You can change it in Settings.", { label: "Undo", onPress: async () => {
        try { await undo(); toast("Undone."); } catch (e) { toast(messageFor(e)); }
      } });
    } catch (e) { toast(messageFor(e)); }
  }
  if (expecting && child) return (
    <Screen scrollRef={scroller} title={titleText}>
      <Stack.Screen options={{ title: titleText }} />
      <Copy numeric kind="small" tone="muted">{today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Copy>
      <SyncStatus />
      <DueReminders />
      {children.length > 1 && <ChildFilter />}
      <LegacyTimer />
      {pregnant ? <PregnancyHero child={child} now={today} /> : <Card tone="hero" style={{ gap: 12 }}>
        <Copy kind="label">Add the birth date</Copy>
        <Copy numeric kind="small" tone="muted">{`${dueLine(child.due_date!, today)}. Add the birth date to start feeding, sleep and diaper logs and see tips for this age.`}</Copy>
        <Button title="Add the birth date" onPress={addBirth} />
      </Card>}
      {tiles.length ? <MoreLogs child={child} now={now} shown={tiles} title="" big onOpen={(open, y) => { if (open) scroller.current?.scrollTo({ y, animated: true }); }} /> : whatShows}
      {/* Right under the tiles, so in labour she needn't scroll for it. */}
      {pregnant && parentHere && <Row title="Baby’s here?" detail="Sets today as the birth date and starts feeding, sleep and diaper logs" icon="heart-outline"
        hint="Saves straight away, with Undo" onPress={() => void arrived()} />}
      {pregnant && <WeekDetails child={child} now={today} tips={tipsNow.rows} />}
      <NextEvent childId={child.id} today={todayKey} now={now} drafts={visitDrafts} />
      {pregnant && <TipSection title="Coming up" view="upcoming" rows={tipsNext.rows} showTiming />}
      <Grouped>{keptRows}</Grouped>
    </Screen>
  );
  const feedsShow = showing("breast", "bottle"),
    todayWords = summaryLine(dayOverlay(b.state, child?.id ?? null, timezone, now)(summary?.[todayKey], todayKey), { feeds: feedsShow, diapers: showing("diaper"), sleep: showing("sleep") }),
    todayLine = `Today: ${todayWords}`;
  const quickLog = child && showCare ? <QuickLog child={child} rows={latestCare.all} now={now} tiles={tiles} who={children.length > 1 ? child.name : undefined} /> : null;
  return (
    <Screen title={titleText} subtitle={child && showCare ? babyAge(child, today) : undefined} numericSubtitle={showCare}
      footer={fontScale < dockBelow ? quickLog : undefined}>
      <Stack.Screen options={{ title: titleText }} />
      <Copy numeric kind="small" tone="muted">{today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Copy>
      <SyncStatus />
      <DueReminders />
      {children.length > 1 && <ChildFilter />}
      {stage === "none" && (parentHere ? <BabySetupCard child={child} /> : <Notice>A parent adds the baby’s details, and Today fills in.</Notice>)}
      {timer ? <LegacyTimer />
        : child && showCare ? (!feedsShow && !running ? null : <CareGlance child={child} rows={latestCare.all} now={now} running={running} timeZone={timezone} sides={showing("breast")} />) : null}
      {showCare && !!todayWords && <PressTarget accessibilityRole="button" accessibilityLabel={todayLine} accessibilityHint="Opens today in Tracker"
        onPress={() => router.navigate({ pathname: "/tracker", params: { day: dayKey(today), at: String(Date.now()) } })}
        style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 4 }}>
        <View style={{ flexShrink: 1 }}><Copy numeric kind="small" tone="muted">{todayLine}</Copy></View>
        <Icon name="chevron-forward" size={16} color={c.muted} />
      </PressTarget>}
      {fontScale >= dockBelow && quickLog}
      {stage === "none" && !showCare && <Copy kind="small" tone="muted">In the meantime</Copy>}
      {showCare && !tiles.length && whatShows}
      {!!child && parentHere && stage === "baby" && <TrackerSuggestion child={child} today={today} now={now} />}
      <NextEvent childId={child?.id ?? null} today={todayKey} now={now} drafts={visitDrafts} quiet={showCare} />
      {!!child && !!latestCare.error && <View style={{ gap: 8 }}>
        <Notice error>{latestCare.error} Care already on this device is shown below.</Notice>
        <Button secondary title="Try loading care again" busy={latestCare.loading} onPress={() => void latestCare.refresh()} />
      </View>}
      {stage === "baby" && child && <BabyAgeCard child={child} now={today} tips={tipsNow.rows} />}
      <Grouped>
        {showCare && showing("sleep") && <Row title={sleepTitle} detail={sleepDetail} numericDetail icon={kindIcon.sleep}
          onPress={() => router.push(sleepEntry ? { pathname: "/record/[id]", params: { id: sleepEntry.id } } : "/care-history")} />}
        {showCare && showing("diaper") && <Row title={`${glance.diapers.total} diaper${glance.diapers.total === 1 ? "" : "s"} today`} numericTitle numericDetail
          detail={`${glance.diapers.wet} pee · ${glance.diapers.dirty} poo`} icon={kindIcon.diaper}
          onPress={() => router.push("/care-history")} />}
        {showCare && !showing("milestone") && <Row title="Milestones" detail="CDC’s list, and your keepsakes" icon={kindIcon.milestone} onPress={() => router.push("/milestones")} />}
        {showCare && !showing("shot") && <Row title="Well visits & shots" detail="Suggested visits, and the shots you record" icon={kindIcon.custom} onPress={() => router.push("/well-visits")} />}
        {keptRows}
        <Row title="Care history" numericDetail detail={showCare && feedsShow ? `${glance.feeds} feed${glance.feeds === 1 ? "" : "s"} today · All care logs` : showCare ? "All care logs" : "Feeding, sleep and diaper logs"} icon="time-outline" onPress={() => router.push("/care-history")} />
      </Grouped>
    </Screen>
  );
}
