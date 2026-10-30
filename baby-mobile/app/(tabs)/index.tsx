import { useRef } from "react";
import { router } from "expo-router";
import { ActionSheetIOS, Alert, Platform, Pressable, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { useBaby } from "@/lib/context";
import { messageFor, type FeedTimer, type RecordData } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { careGlance, glanceChild, nextFeed } from "@/lib/care-glance";
import { careSummary, friendlyTime } from "@/lib/care-format";
import { routineToday } from "@/lib/today-routines";
import { careWrite, logCare, updateCare } from "@/lib/quick-care";
import { activeTimer, changeTimer, feedRecordData, sideChoices, startTimer, type FeedSide } from "@/lib/feed-timer";
import { Button, Card, Copy, Empty, Icon, Loading, Notice, Row, Screen, Section, useColors, useToast, type IconName } from "@/components/ui";
import { RecordRow, kindIcon } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { CareGlance, useMinuteClock } from "@/components/care-glance";
import { FeedTimerCard } from "@/components/feed-timer";

const diaperChoices: { label: string; type: NonNullable<RecordData["type"]> }[] = [
  { label: "Wet", type: "wet" },
  { label: "Dirty", type: "dirty" },
  { label: "Wet + dirty", type: "both" },
  { label: "Dry", type: "dry" },
];

function Tile({ icon, label, hint, onPress }: { icon: IconName; label: string; hint: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 19,
        paddingHorizontal: 8,
        borderRadius: 22,
        backgroundColor: c.tile,
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={25} />
      <Copy kind="small" align="center">
        {label}
      </Copy>
    </Pressable>
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
    care = latestCare.rows,
    glance = careGlance(latestCare.all, child?.id ?? null, now),
    routines = records.filter((r) => routineToday(r, now)),
    showCare = !!child && (!child.due_date || !!child.birth_date || care.length > 0),
    timer = activeTimer(b.state),
    timerChild = timer && children.find((c) => c.id === timer.child_id),
    writing = useRef(false);
  async function quick(action: () => Promise<() => Promise<void>>, message: string) {
    // One write at a time: a double tap must not start two sleeps or end one twice.
    if (writing.current) return;
    writing.current = true;
    try {
      const undo = await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
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
    if (timer) return toast("A feeding timer is running. Finish it from the timer card.");
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
  return (
    <Screen
      title={now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings and profiles"
          onPress={() => router.push("/settings")}
          style={{ padding: 10 }}
        >
          <Icon name="person-circle-outline" size={30} />
        </Pressable>
      }
    >
      <SyncStatus />
      {!children.length && <Row title="Add a baby profile" detail="Optional · personalize everyday care when you’re ready"
        icon="person-add-outline" onPress={() => router.push("/child")} />}
      {children.length > 1 && <ChildFilter />}
      {child && showCare && <CareGlance child={child} rows={latestCare.all} now={now} />}
      {showCare && <View style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", gap: 10 }}>
        <Tile
          icon={kindIcon.feeding}
          label={timer ? "Feeding…" : "Feed"}
          hint={timer ? "A feeding timer is running on the card above" : "Start a breastfeeding timer or log a feed"}
          onPress={feed}
        />
        <Tile
          icon={glance.openSleep ? "sunny-outline" : kindIcon.sleep}
          label={glance.openSleep ? "Wake up" : "Sleep"}
          hint={glance.openSleep ? "Ends the current sleep now" : "Starts a sleep now"}
          onPress={sleep}
        />
        <Tile icon={kindIcon.diaper} label="Diaper" hint="Choose wet, dirty or both" onPress={diaper} />
      </View>}
      {timer && timerChild && <FeedTimerCard timer={timer} childName={timerChild.name} onDone={finishFeed} />}
      {(care.length > 0 || latestCare.loading || latestCare.error) && (
        <Section title="Recent care">
          {latestCare.loading && !care.length && <Loading label="Loading latest care…" />}
          {!!latestCare.error && (
            <>
              <Notice error>{latestCare.error} Care already on this device is shown below.</Notice>
              <Button secondary title="Try loading care again" busy={latestCare.loading} onPress={() => void latestCare.refresh()} />
            </>
          )}
          {care.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              now={now}
              pending={b.state.outbox.some((m) => m.type !== "import" && m.record.id === r.id)}
            />
          ))}
        </Section>
      )}
      <Row title="Write a journal entry" detail="A thought, photo or small moment" icon="book-outline"
        onPress={() => router.push({ pathname: "/edit", params: { kind: "journal" } })} />
      {routines.length > 0 && <Section title="Today’s routines">
        {routines.slice(0, 2).map((r) => <RecordRow key={r.id} record={r} />)}
      </Section>}
      {records.filter((r) => r.kind === "source" || r.kind === "journal").length > 0 && (
        <Section title="Recently saved">
          {records
            .filter((r) => r.kind === "source" || r.kind === "journal")
            .slice(0, 3)
            .map((r) => (
              <RecordRow key={r.id} record={r} />
            ))}
        </Section>
      )}
      <View style={{ height: 40 }} />
    </Screen>
  );
}
