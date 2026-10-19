import { router } from "expo-router";
import { View, Pressable } from "react-native";
import { useBaby } from "@/lib/context";
import { type Kind } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { Button, Card, Copy, Empty, Icon, Loading, Notice, Row, Screen, Section, useColors } from "@/components/ui";
import { RecordRow, kindIcon } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
export default function Today() {
  const b = useBaby(),
    c = useColors(),
    profile = b.state.bootstrap!.profile,
    child = b.state.bootstrap!.children.find((c) => c.id === b.state.selectedChild),
    records = b.records.filter((r) => !b.state.selectedChild || r.child_id === b.state.selectedChild || !r.child_id),
    latestCare = useTodayCare(),
    care = latestCare.rows,
    routines = records.filter((r) => r.kind === "routine"),
    name = profile.display_name.split(" ")[0];
  return (
    <Screen
      title={name ? `A little space, ${name}.` : "A little space for you."}
      subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
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
      {!b.state.bootstrap!.children.length && (
        <Card tone="hero">
          <Copy kind="heading">Welcome to your next chapter.</Copy>
          <Copy>
            Keep the advice you want to remember, the moments you want to keep, and everyday care in one calm place.
          </Copy>
          <Button title="Make this space yours" onPress={() => router.push("/onboarding")} />
        </Card>
      )}
      <ChildFilter />
      <Section title="Right here, when you need it">
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(["feeding", "sleep", "diaper"] as Kind[]).map((kind) => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={`Log ${kind}`}
              onPress={() => router.push({ pathname: "/edit", params: { kind } })}
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
              <Icon name={kindIcon[kind]} size={25} />
              <Copy kind="small">{kind === "feeding" ? "Feed" : kind === "sleep" ? "Sleep" : "Diaper"}</Copy>
            </Pressable>
          ))}
        </View>
      </Section>
      {(care.length > 0 || latestCare.loading || latestCare.error) && (
        <Section title={child ? `${child.name}’s latest` : "Latest care"}>
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
