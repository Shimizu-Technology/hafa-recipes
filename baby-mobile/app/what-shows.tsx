import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Switch, Text, View, useWindowDimensions } from "react-native";
import { Chips, Copy, Grouped, Icon, Notice, Row, Screen, fonts, typeScale, useColors } from "@/components/ui";
import { SyncStatus } from "@/components/sync-status";
import { useBaby } from "@/lib/context";
import { setTracking } from "@/lib/quick-care";
import { profileToday, timingChild, trackerStage } from "@/lib/timing";
import { trackerOn, trackersFor, type Tracker } from "../lib/trackers";

function Line({ tracker, on, onChange }: { tracker: Tracker; on: boolean; onChange: (on: boolean) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 16 }}>
    <Icon name={tracker.icon} size={20} color={c.placeholderInk} />
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ flex: 1, minWidth: 0, ...typeScale.headline, fontFamily: fonts.semibold, color: c.text }}>{tracker.label}</Text>
    <Switch accessibilityLabel={tracker.label} value={on} onValueChange={onChange} trackColor={{ true: c.action }} />
  </View>;
}

/** A plain list of switches, per baby. Off hides a button; nothing logged goes anywhere. */
export default function WhatShows() {
  const b = useBaby(), params = useLocalSearchParams<{ child?: string }>(), bootstrap = b.state.bootstrap!, children = bootstrap.children,
    today = profileToday(new Date(), bootstrap.profile.timezone),
    [picked, setPicked] = useState(params.child),
    child = children.find((one) => one.id === picked) ?? timingChild(b.state, today);
  if (!child) return <Screen title="What shows" back>
    <Row title="Set up your baby" detail="Then choose what shows" icon="person-add-outline" onPress={() => router.push("/child")} />
  </Screen>;
  const stage = trackerStage(child, today), listed = trackersFor(stage),
    waiting = b.state.outbox.some((m) => m.type === "child_tracking" && m.child_id === child.id),
    group = (title: string, rows: Tracker[]) => <View style={{ gap: 8 }}>
      <Copy kind="small" tone="muted">{title}</Copy>
      <Grouped separatorInset={48}>{rows.map((tracker) => <Line key={tracker.id} tracker={tracker} on={trackerOn(tracker, stage, child.details)} onChange={(on) => void setTracking(b, child, tracker.id, on)} />)}</Grouped>
    </View>;
  return <Screen title="What shows" back>
    <Copy tone="muted">What’s on gets a button on Today and Tracker. Off only hides the button: everything logged stays in Tracker, Stats, the doctor summary and history, and Add always has it all.</Copy>
    <SyncStatus />
    {children.length > 1 && <Chips label="Baby" value={child.id} options={children.map((one) => ({ label: one.name, value: one.id }))} onChange={setPicked} />}
    {waiting && b.online === false && <Notice>Saved on this phone. It reaches the app when you’re back online.</Notice>}
    {group(`For ${child.name}`, listed.filter((tracker) => tracker.about === "baby"))}
    {group("For you", listed.filter((tracker) => tracker.about === "her"))}
  </Screen>;
}
