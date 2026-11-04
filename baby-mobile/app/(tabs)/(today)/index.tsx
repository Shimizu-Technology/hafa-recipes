import { useRef } from "react";
import { Stack, router } from "expo-router";
import { Text, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { useBaby } from "@/lib/context";
import { messageFor, type FeedTimer } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { sleepGlanceDetail, babyAge, careGlance } from "@/lib/care-glance";
import { careSummary } from "@/lib/care-format";
import { routineToday, routineReminderLabel } from "@/lib/today-routines";
import { careWrite, logCare } from "@/lib/quick-care";
import { activeTimer, changeTimer, feedRecordData } from "@/lib/feed-timer";
import { runningFeed } from "@/lib/feed-reducer";
import { Button, Card, Copy, Grouped, PressTarget, Icon, Notice, Row, Screen, radii, typeScale, useColors, useToast, type IconName } from "@/components/ui";
import { kindIcon } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { CareGlance, FirstStep, useMinuteClock } from "@/components/care-glance";
import { FeedTimerCard } from "@/components/feed-timer";
import { QuickLog } from "@/components/quick-log";
import { PregnancyHero, TipSection } from "@/components/tips";
import { dueLine, profileToday, timingChild, todayStage } from "@/lib/timing";
import { useTimingTips } from "@/lib/use-timing-tips";

/** The docked log covers too much of the screen at the largest text sizes, so it scrolls with the page there. */
const dockBelow = 1.5;

function Tile({ icon, label, hint, onPress, primary }: { icon: IconName; label: string; hint: string; onPress: () => void; primary?: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return (
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: fontScale >= 1.3 ? 0 : 1,
        minHeight: 84,
        flexBasis: fontScale >= 1.3 ? undefined : 0,
        flexShrink: 1,
        minWidth: 0,
        paddingVertical: 16,
        paddingHorizontal: 8,
        borderRadius: radii.tile,
        backgroundColor: primary ? c.action : c.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      })}
    >
      <Icon name={icon} size={22} color={primary ? c.onAction : c.accentText} />
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.headline, color: primary ? c.onAction : c.text, textAlign: "center" }}>{label}</Text>
    </PressTarget>
  );
}

export default function Today() {
  const b = useBaby(), c = useColors(),
    toast = useToast(),
    now = useMinuteClock(),
    { fontScale } = useWindowDimensions(),
    children = b.state.bootstrap!.children,
    // The profile's calendar day, as the API counts pregnancy weeks and baby age.
    today = profileToday(now, b.state.bootstrap!.profile.timezone),
    child = timingChild(b.state, today),
    records = b.records.filter((r) => !r.child_id || r.child_id === child?.id),
    latestCare = useTodayCare(),
    glance = careGlance(latestCare.all, child?.id ?? null, now),
    routines = records.filter((r) => routineToday(r, now)),
    stage = todayStage(child, today),
    pregnant = stage === "pregnancy",
    expecting = pregnant || stage === "needs_birth",
    showCare = !!child && !expecting,
    tipsNow = useTimingTips(child, "now", 5, today),
    tipsNext = useTimingTips(pregnant ? child : null, "upcoming", 3, today),
    // A device timer is from an older build: it finishes the old way, on its own card, and is gone.
    timer = activeTimer(b.state),
    timerChild = timer && children.find((c) => c.id === timer.child_id),
    running = runningFeed(latestCare.all, child?.id ?? null, now),
    writing = useRef(false);
  async function quick(action: () => Promise<() => Promise<void>>, message: string) {
    // One write at a time: a double tap must not start two sleeps or end one twice.
    if (writing.current) return;
    writing.current = true;
    try {
      const undo = await action();
      void Haptics.selectionAsync().catch(() => undefined);
      toast(message, {
        label: "Undo",
        onPress: async () => {
          try {
            await undo();
            toast("Undone.");
          } catch (e) {
            toast(messageFor(e));
          }
        },
      });
    } catch (e) {
      toast(messageFor(e));
    } finally {
      writing.current = false;
    }
  }
  /** Save the timed feed and clear the timer in one write. Undo removes the feed only. */
  function finishFeed(running: FeedTimer) {
    const data = feedRecordData(running),
      record = careWrite("feeding", running.child_id, data, new Date(running.started_at));
    return quick(
      () => logCare(b, record, (s) => changeTimer(s, running.started_at, () => undefined)),
      `${careSummary("feeding", data, record.occurred_at)} · logged`
    );
  }
  const sleepEntry = glance.openSleep ?? glance.lastSleep,
    sleepTitle = glance.openSleep ? "Sleeping now" : glance.lastSleep ? "Awake" : "Sleep",
    sleepDetail = sleepGlanceDetail(glance, now),
    routine = routines[0],
    questions = records.filter((r) => r.kind === "question").length;
  const titleText = child?.name.trim() || "Today";
  const addBirth = () => child && router.push({ pathname: "/child", params: { id: child.id } });
  if (expecting && child) return (
    <Screen title={titleText}>
      <Stack.Screen options={{ title: titleText }} />
      <Copy numeric kind="small" tone="muted">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Copy>
      <SyncStatus />
      {children.length > 1 && <ChildFilter />}
      {timer && timerChild && <FeedTimerCard timer={timer} childName={timerChild.name} onDone={finishFeed} />}
      {pregnant ? <>
        <PregnancyHero child={child} now={today} tips={tipsNow.rows} />
        <TipSection title="Coming up" view="upcoming" rows={tipsNext.rows} showTiming />
      </> : <Card tone="hero" style={{ gap: 12 }}>
        <Copy kind="label">Add the birth date</Copy>
        <Copy numeric kind="small" tone="muted">{`${dueLine(child.due_date!, today)}. Add the birth date to start feeding, sleep and diaper logs and see tips for this age.`}</Copy>
        <Button title="Add the birth date" onPress={addBirth} />
      </Card>}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 12 }}>
          <Tile icon="link-outline" label="Save a link" hint="Paste a link, or share from TikTok, Instagram or Safari"
            onPress={() => router.push({ pathname: "/edit", params: { kind: "source" } })} />
          <Tile icon="book-outline" label="Journal" hint="Write a note or add photos and documents"
            onPress={() => router.push({ pathname: "/edit", params: { kind: "journal" } })} />
          <Tile icon={kindIcon.question} label="Doctor question" hint="Keep a question for your next visit"
            onPress={() => router.push({ pathname: "/edit", params: { kind: "question" } })} />
        </View>
        <Copy kind="small" tone="muted">Tip: share straight from TikTok, Instagram or Safari.</Copy>
      </View>
      <Grouped>
        <Row title="Doctor questions" icon={kindIcon.question} numericDetail
          detail={questions ? `${questions} saved · for your next visit` : "Keep questions for your next visit"}
          onPress={() => router.navigate({ pathname: "/journal", params: { filter: "question", at: String(Date.now()) } })} />
        <Row title="Journal" detail="Notes, photos and documents" icon="book-outline"
          onPress={() => router.navigate({ pathname: "/journal", params: { filter: "journal", at: String(Date.now()) } })} />
        <Row numericDetail title={routine?.title || "Lists & routines"}
          detail={routine?.data.reminder_at ? routineReminderLabel(routine) : routine ? "Your next checklist · Lists & routines" : "Checklists, chosen plans and reminders"}
          icon="checkmark-circle-outline" onPress={() => router.push("/routines")} />
      </Grouped>
      {pregnant && <Row title="Baby’s here?" detail="Add birth details to start feeding, sleep and diaper logs" icon="heart-outline"
        onPress={addBirth} />}
    </Screen>
  );
  const quickLog = child && showCare ? <QuickLog child={child} rows={latestCare.all} now={now} legacyTimer={!!timer} /> : null;
  return (
    <Screen title={titleText} subtitle={child ? showCare ? babyAge(child, now) : child.name : undefined} numericSubtitle={showCare}
      footer={fontScale < dockBelow ? quickLog : undefined}>
      <Stack.Screen options={{ title: titleText }} />
      <Copy numeric kind="small" tone="muted">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Copy>
      <SyncStatus />
      {children.length > 1 && <ChildFilter />}
      {timer && timerChild ? <FeedTimerCard timer={timer} childName={timerChild.name} onDone={finishFeed} />
        : child && showCare ? <CareGlance child={child} rows={latestCare.all} now={now} running={running} /> : <FirstStep child={child} now={now} />}
      {fontScale >= dockBelow && quickLog}
      {!!latestCare.error && <View style={{ gap: 8 }}>
        <Notice error>{latestCare.error} Care already on this device is shown below.</Notice>
        <Button secondary title="Try loading care again" busy={latestCare.loading} onPress={() => void latestCare.refresh()} />
      </View>}
      <Grouped>
        {showCare && <Row title={sleepTitle} detail={sleepDetail} numericDetail icon={kindIcon.sleep}
          onPress={() => router.push(sleepEntry ? { pathname: "/record/[id]", params: { id: sleepEntry.id } } : "/care-history")} />}
        {showCare && <Row title={`${glance.diapers.total} diaper${glance.diapers.total === 1 ? "" : "s"} today`} numericTitle numericDetail
          detail={`${glance.diapers.wet} pee · ${glance.diapers.dirty} poo`} icon={kindIcon.diaper}
          onPress={() => router.push("/care-history")} />}
        <Row numericDetail title={routine?.title || "Lists & routines"}
          detail={routine?.data.reminder_at ? routineReminderLabel(routine) : routine ? "Your next checklist · Lists & routines" : "Checklists, chosen plans and reminders"}
          icon="checkmark-circle-outline" onPress={() => router.push("/routines")} />
        <Row title="Journal" detail="Notes, photos and documents" icon="book-outline"
          onPress={() => router.navigate({ pathname: "/journal", params: { filter: "journal", at: String(Date.now()) } })} />
        <Row title="Care history" numericDetail detail={showCare ? `${glance.feeds} feed${glance.feeds === 1 ? "" : "s"} today · All care logs` : "Feeding, sleep and diaper logs"} icon="time-outline" onPress={() => router.push("/care-history")} />
      </Grouped>
      {stage === "baby" && <TipSection title="For this age" view="now" rows={tipsNow.rows} />}
      {!children.length && <Row title="Add a baby profile" detail="Personalize everyday care when you’re ready"
        icon="person-add-outline" onPress={() => router.push("/child")} />}
    </Screen>
  );
}
