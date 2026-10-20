import { router } from "expo-router";
import { ActionSheetIOS, Alert, Platform, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useBaby } from "@/lib/context";
import { messageFor, type RecordData } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { careGlance, glanceChild } from "@/lib/care-glance";
import { careSummary, friendlyTime } from "@/lib/care-format";
import { careWrite, logCare, updateCare } from "@/lib/quick-care";
import { Button, Card, Copy, Empty, Icon, Loading, Notice, Screen, Section, useColors, useToast, type IconName } from "@/components/ui";
import { RecordRow, kindIcon } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { CareGlance, useMinuteClock } from "@/components/care-glance";

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
        backgroundColor: c.hero,
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
    profile = b.state.bootstrap!.profile,
    children = b.state.bootstrap!.children,
    child = glanceChild(b.state),
    records = b.records.filter((r) => !b.state.selectedChild || r.child_id === b.state.selectedChild || !r.child_id),
    latestCare = useTodayCare(),
    care = latestCare.rows,
    glance = careGlance(latestCare.all, child?.id ?? null, now),
    routines = records.filter((r) => r.kind === "routine"),
    name = profile.display_name.split(" ")[0];
  async function quick(action: () => Promise<() => Promise<void>>, message: string) {
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
    }
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
    Alert.alert(`Diaper for ${child.name}`, undefined, [
      ...diaperChoices.slice(0, 2).map((choice) => ({ text: choice.label, onPress: () => save(choice.type) })),
      { text: "More…", onPress: details },
    ]);
  }
  return (
    <Screen
      title={name ? `A little space, ${name}.` : "A little space for you."}
      subtitle={now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
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
      {!children.length && (
        <Card tone="hero">
          <Copy kind="heading">Welcome to your next chapter.</Copy>
          <Copy>
            Keep the advice you want to remember, the moments you want to keep, and everyday care in one calm place.
          </Copy>
          <Button title="Make this space yours" onPress={() => router.push("/onboarding")} />
        </Card>
      )}
      {children.length > 1 && <ChildFilter />}
      {child && <CareGlance child={child} rows={latestCare.all} now={now} />}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Tile
          icon={kindIcon.feeding}
          label="Feed"
          hint="Opens a feeding log with the next side chosen"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "feeding" } })}
        />
        <Tile
          icon={glance.openSleep ? "sunny-outline" : kindIcon.sleep}
          label={glance.openSleep ? "Wake up" : "Sleep"}
          hint={glance.openSleep ? "Ends the current sleep now" : "Starts a sleep now"}
          onPress={sleep}
        />
        <Tile icon={kindIcon.diaper} label="Diaper" hint="Choose wet, dirty or both" onPress={diaper} />
      </View>
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
              pending={b.state.outbox.some((m) => m.type !== "import" && m.record.id === r.id)}
            />
          ))}
        </Section>
      )}
      <Section title="Your chosen routines">
        {routines.length ? (
          routines.slice(0, 2).map((r) => <RecordRow key={r.id} record={r} />)
        ) : (
          <Empty
            title="Find your rhythm"
            body="A packing list, a routine you chose, or a gentle reminder. Make room for what helps."
            icon="checkmark-circle-outline"
            action={
              <Button
                secondary
                title="Create a routine"
                onPress={() => router.push({ pathname: "/edit", params: { kind: "routine" } })}
              />
            }
          />
        )}
      </Section>
      <Card tone="soft">
        <Copy kind="heading">Something worth keeping?</Copy>
        <Copy tone="muted">Save a video, write a thought, or keep a question for your next appointment.</Copy>
        <Button secondary title="Save something" icon="add" onPress={() => router.push("/add")} />
      </Card>
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
