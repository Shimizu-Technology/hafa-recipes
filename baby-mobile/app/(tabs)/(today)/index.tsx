import { useRef } from "react";
import { Stack, router } from "expo-router";
import { ActionSheetIOS, Alert, Platform, Text, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { useBaby } from "@/lib/context";
import { messageFor, type FeedTimer, type RecordData } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { babyAge, careGlance, glanceChild, nextFeed } from "@/lib/care-glance";
import { careSummary, duration, friendlyTime, timeAgo } from "@/lib/care-format";
import { routineToday } from "@/lib/today-routines";
import { careWrite, logCare, updateCare } from "@/lib/quick-care";
import { activeTimer, changeTimer, feedRecordData, sideChoices, startTimer, type FeedSide } from "@/lib/feed-timer";
import { Button, Copy, Grouped, PressTarget, Icon, Notice, Row, Screen, typeScale, useColors, useToast, type IconName } from "@/components/ui";
import { kindIcon } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { CareGlance, FirstStep, useMinuteClock } from "@/components/care-glance";
import { FeedTimerCard } from "@/components/feed-timer";

const diaperChoices: { label: string; type: NonNullable<RecordData["type"]> }[] = [
  { label: "Wet", type: "wet" },
  { label: "Dirty", type: "dirty" },
  { label: "Wet + dirty", type: "both" },
  { label: "Dry", type: "dry" },
];

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
        borderRadius: 20,
        backgroundColor: primary ? c.action : c.soft,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      })}
    >
      <Icon name={icon} size={22} color={primary ? c.onAction : c.action} />
      <Text style={{ ...typeScale.headline, color: primary ? c.onAction : c.text, textAlign: "center" }}>{label}</Text>
    </PressTarget>
  );
}

export default function Today() {
  const b = useBaby(),
    toast = useToast(),
    now = useMinuteClock(),
    { fontScale } = useWindowDimensions(),
    children = b.state.bootstrap!.children,
    child = glanceChild(b.state),
    records = b.records.filter((r) => !b.state.selectedChild || r.child_id === b.state.selectedChild || !r.child_id),
    latestCare = useTodayCare(),
    glance = careGlance(latestCare.all, child?.id ?? null, now),
    routines = records.filter((r) => routineToday(r, now)),
    showCare = !!child && (!child.due_date || !!child.birth_date),
    timer = activeTimer(b.state),
    timerChild = timer && children.find((c) => c.id === timer.child_id),
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
  function feed() {
    if (!child) return router.push({ pathname: "/edit", params: { kind: "feeding" } });
    if (timer) return toast("A feeding timer is running. Finish it from the timer above.");
    const choices = sideChoices(nextFeed(glance.lastFeed).side),
      labels = choices.map((choice) => `Start ${choice.side} side${choice.suggested ? " (next)" : ""}`);
    const start = (side: FeedSide) =>
      void b
        .commit((s) => (activeTimer(s) ? s : { ...s, feedTimer: startTimer(child.id, s.bootstrap!.generation, side) }))
        .catch((e) => toast(messageFor(e)));
    const details = () => router.push({ pathname: "/edit", params: { kind: "feeding" } });
    if (Platform.OS === "ios")
      return ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Feed ${child.name}`,
          options: [...labels, "Log a bottle or past feed…", "Cancel"],
          cancelButtonIndex: 3,
        },
        (index) => (index < 2 ? start(choices[index].side) : index === 2 && details())
      );
    Alert.alert(
      `Feed ${child.name}`,
      undefined,
      [
        ...labels.map((text, i) => ({ text, onPress: () => start(choices[i].side) })),
        { text: "Bottle or past feed…", onPress: details },
      ],
      { cancelable: true }
    );
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
  function sleep() {
    if (!child) return router.push({ pathname: "/edit", params: { kind: "sleep" } });
    const open = glance.openSleep;
    if (open) {
      const data = { ...open.data, end_at: new Date().toISOString() };
      return void quick(() => updateCare(b, open, data), `${careSummary("sleep", data, open.occurred_at)} · logged`);
    }
    void quick(() => logCare(b, careWrite("sleep", child.id, {})), `Sleep started at ${friendlyTime(new Date().toISOString())}`);
  }
  function diaper() {
    if (!child) return router.push({ pathname: "/edit", params: { kind: "diaper" } });
    const save = (type: NonNullable<RecordData["type"]>) =>
      void quick(
        () => logCare(b, careWrite("diaper", child.id, { type })),
        `${careSummary("diaper", { type }, "")} logged at ${friendlyTime(new Date().toISOString())}`
      );
    const details = () => router.push({ pathname: "/edit", params: { kind: "diaper" } });
    if (Platform.OS === "ios")
      return ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Diaper for ${child.name}`,
          options: [...diaperChoices.map((choice) => choice.label), "Add time or note…", "Cancel"],
          cancelButtonIndex: diaperChoices.length + 1,
        },
        (index) => (index < diaperChoices.length ? save(diaperChoices[index].type) : index === diaperChoices.length && details())
      );
    Alert.alert(
      `Diaper for ${child.name}`,
      undefined,
      [
        ...diaperChoices.slice(0, 2).map((choice) => ({ text: choice.label, onPress: () => save(choice.type) })),
        { text: "More…", onPress: details },
      ],
      { cancelable: true }
    );
  }
  const sleepEntry = glance.openSleep ?? glance.lastSleep,
    sleepTitle = glance.openSleep ? "Sleeping now" : "Awake",
    sleepDetail = glance.openSleep ? careSummary("sleep", glance.openSleep.data, glance.openSleep.occurred_at, now).replace("Sleeping now · ", "")
      : glance.lastSleep ? `Woke ${timeAgo(glance.lastSleep.data.end_at!, now)} · Last sleep ${duration((new Date(glance.lastSleep.data.end_at!).getTime() - new Date(glance.lastSleep.occurred_at).getTime()) / 60_000)}`
      : "No sleep logged yet",
    routine = routines[0];
  return (
    <Screen title={child && showCare ? child.name : "Today"} subtitle={child ? babyAge(child, now) : undefined} numericSubtitle>
      <Stack.Screen options={{ title: child && showCare ? child.name : "Today" }} />
      <Copy kind="small" tone="muted">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Copy>
      <SyncStatus />
      {children.length > 1 && <ChildFilter />}
      {timer && timerChild ? <FeedTimerCard timer={timer} childName={timerChild.name} onDone={finishFeed} />
        : child && showCare ? <CareGlance child={child} rows={latestCare.all} now={now} /> : <FirstStep child={child} now={now} />}
      {showCare && <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 12 }}>
        <Tile primary={!timer}
          icon={kindIcon.feeding}
          label={timer ? "Feeding…" : "Feed"}
          hint={timer ? "A feeding timer is running above" : "Start a breastfeeding timer or log a feed"}
          onPress={feed}
        />
        <Tile icon={glance.openSleep ? "sunny-outline" : kindIcon.sleep}
          label={glance.openSleep ? "Wake up" : "Sleep"}
          hint={glance.openSleep ? "Ends the current sleep now" : "Starts a sleep now"} onPress={sleep} />
        <Tile icon={kindIcon.diaper} label="Diaper" hint="Choose wet, dirty or both" onPress={diaper} />
      </View>}
      {!!latestCare.error && <View style={{ gap: 8 }}>
        <Notice error>{latestCare.error} Care already on this device is shown below.</Notice>
        <Button secondary title="Try loading care again" busy={latestCare.loading} onPress={() => void latestCare.refresh()} />
      </View>}
      <Grouped>
        {showCare && <Row title={sleepTitle} detail={sleepDetail} icon={kindIcon.sleep}
          onPress={() => router.push(sleepEntry ? { pathname: "/record/[id]", params: { id: sleepEntry.id } } : "/care-history")} />}
        {showCare && <Row title={`${glance.diapers.total} diapers today`} numericTitle
          detail={`${glance.diapers.wet} wet · ${glance.diapers.dirty} dirty`} icon={kindIcon.diaper}
          onPress={() => router.push("/care-history")} />}
        <Row title={routine?.title || "Lists & routines"}
          detail={routine?.data.reminder_at ? `Reminder ${friendlyTime(routine.data.reminder_at, now)}` : routine ? "Your next checklist · Lists & routines" : "Checklists, chosen plans and reminders"}
          icon="checkmark-circle-outline" onPress={() => router.push("/routines")} />
        <Row title="Write in your journal" icon="book-outline"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "journal" } })} />
        <Row title="Care history" detail="Feeding, sleep and diaper logs" icon="time-outline" onPress={() => router.push("/care-history")} />
      </Grouped>
      {!children.length && <Row title="Add a baby profile" detail="Personalize everyday care when you’re ready"
        icon="person-add-outline" onPress={() => router.push("/child")} />}
    </Screen>
  );
}
