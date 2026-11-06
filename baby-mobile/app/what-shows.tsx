import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Switch, Text, View, useWindowDimensions } from "react-native";
import { Chips, Copy, Grouped, Icon, Row, Screen, fonts, typeScale, useColors , Notice } from "@/components/ui";
import { SyncStatus } from "@/components/sync-status";
import { useBaby } from "@/lib/context";
import { setTracking } from "@/lib/quick-care";
import { profileToday, timingChild, trackerStage } from "@/lib/timing";
import { trackerOn, trackersFor, trackingKey, type Tracker } from "../lib/trackers";
import { babyLabel, canAddBaby, canChangeBaby, remindersOn } from "../lib/spaces";

function Line({ tracker, on, onChange }: { tracker: Tracker; on: boolean; onChange: (on: boolean) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  // At the largest sizes a long name needs the whole row, so the switch goes under it.
  const stacked = fontScale >= 2;
  return <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: stacked ? 8 : 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 16 }}>
    {!stacked && <Icon name={tracker.icon} size={20} color={c.placeholderInk} />}
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...(stacked ? {} : { flex: 1, minWidth: 0 }), ...typeScale.headline, fontFamily: fonts.semibold, color: c.text }}>{tracker.label}</Text>
    <Switch accessibilityLabel={tracker.label} value={on} onValueChange={onChange} trackColor={{ true: c.action }} />
  </View>;
}

/** A plain list of switches, per baby. Off hides a button; nothing logged goes anywhere. */
export default function WhatShows() {
  const b = useBaby(), params = useLocalSearchParams<{ child?: string }>(), bootstrap = b.state.bootstrap!, children = bootstrap.children,
    today = profileToday(new Date(), bootstrap.profile.timezone),
    [picked, setPicked] = useState(params.child),
    child = children.find((one) => one.id === picked) ?? timingChild(b.state, today);
  // The API takes a switch only from a parent of that baby, so this doesn't offer it.
  if (child ? !canChangeBaby(bootstrap, child) : !canAddBaby(bootstrap)) return <Screen title="What shows" back><Notice>A parent chooses what shows for this baby.</Notice>{remindersOn(bootstrap) && <Row title="Reminders" detail="Choose what notifies you" icon="alarm-outline" onPress={() => router.push("/reminders")} />}</Screen>;
  if (!child) return <Screen title="What shows" back>
    <Row title="Set up your baby" detail="Then choose what shows" icon="person-add-outline" onPress={() => router.push("/child")} />
  </Screen>;
  const stage = trackerStage(child, today), listed = trackersFor(stage),
    group = (title: string, rows: Tracker[]) => <View style={{ gap: 8 }}>
      <Copy kind="small" tone="muted">{title}</Copy>
      <Grouped separatorInset={48}>{rows.map((tracker) => <Line key={tracker.id} tracker={tracker} on={trackerOn(tracker, stage, child.details)} onChange={(on) => void setTracking(b, child, { [trackingKey(tracker.id, stage)]: on })} />)}</Grouped>
    </View>;
  return <Screen title="What shows" back>
    <Copy tone="muted">What’s on gets a button on Today and Tracker. Off only hides the button: everything logged stays in Tracker, Stats, the doctor summary and history, and Add always has it all.</Copy>
    {/* Says "Saved on this phone" with no signal, and carries her to a change the API refused. */}
    <SyncStatus />
    {children.length > 1 && <Chips label="Baby" value={child.id} options={children.map((one) => ({ label: babyLabel(one, bootstrap), value: one.id }))} onChange={setPicked} />}
    {group(`For ${babyLabel(child, bootstrap)}`, listed.filter((tracker) => tracker.about === "baby"))}
    {group("For you", listed.filter((tracker) => tracker.about === "her"))}
    {remindersOn(bootstrap) && <Row title="Reminders" detail="Choose what notifies you, and quiet hours" icon="alarm-outline" onPress={() => router.push("/reminders")} />}
  </Screen>;
}
