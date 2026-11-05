import { useEffect, useState } from "react";
import { AppState, Linking, Platform, Switch, Text, View, useWindowDimensions } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Chips, Copy, Grouped, Notice, Row, Screen, Section, fonts, typeScale, useColors } from "@/components/ui";
import { TimeField } from "@/components/time-field";
import { SyncStatus } from "@/components/sync-status";
import { useBaby } from "@/lib/context";
import type { KindPref, ReminderKind } from "@/lib/models";
import { askToNotify } from "@/lib/reminder-permission";
import { kindsFor, quietWindow, remindersOn, savePrefs, shownPrefs, turnOn } from "@/lib/reminder-prefs";

const words: Partial<Record<ReminderKind, { title: string; detail: string }>> = {
  feed_interval: { title: "Feed reminder", detail: "Hours after the last feed, logged on any phone" },
  event: { title: "Event reminders", detail: "At the times set on each event" },
  running_timer: { title: "Running timers", detail: "A feed or sleep timer that’s been left on" },
  pregnancy_week: { title: "New week", detail: "The morning a new pregnancy week starts" },
  visit_prep: { title: "Visit questions", detail: "The evening before a visit you’ve saved questions for" },
  import: { title: "Saved posts", detail: "When a post you saved has finished" },
};
const hourChoices = ["1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6"];
const hourLabel = (hours: string) => (hours === "1" ? "1 hour" : `${hours} hours`);

function Line({ title, detail, on, onChange }: { title: string; detail?: string; on: boolean; onChange: (on: boolean) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  // At the largest sizes a long name needs the whole row, so the switch goes under it.
  const stacked = fontScale >= 2;
  return <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: stacked ? 8 : 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 16 }}>
    <View style={{ ...(stacked ? {} : { flex: 1, minWidth: 0 }), gap: 2 }}>
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.headline, fontFamily: fonts.semibold, color: c.text }}>{title}</Text>
      {!!detail && <Copy kind="small" tone="muted">{detail}</Copy>}
    </View>
    <Switch accessibilityLabel={title} value={on} onValueChange={onChange} trackColor={{ true: c.action }} />
  </View>;
}

/** Per person, on every phone they use. Nothing here asks the phone for anything until she turns something on. */
export default function Reminders() {
  const b = useBaby(), bootstrap = b.state.bootstrap!, prefs = shownPrefs(b.state), [denied, setDenied] = useState(false),
    [choosingHours, setChoosingHours] = useState(false), [opening, setOpening] = useState(""),
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const live = remindersOn(bootstrap);
  useEffect(() => { if (live) void b.refreshPrefs(); }, [live]);
  useEffect(() => {
    if (!live) return;
    const look = () => { if (Platform.OS !== "web") void Notifications.getPermissionsAsync().then((now) => setDenied(!now.granted && !now.canAskAgain)).catch(() => undefined); };
    look();
    const app = AppState.addEventListener("change", (status) => { if (status === "active") look(); });
    return () => app.remove();
  }, [live]);
  if (!remindersOn(bootstrap)) return <Screen title="Reminders" back><Notice>Reminders aren’t available yet.</Notice></Screen>;
  const kinds = kindsFor(bootstrap, bootstrap.children), anyOn = kinds.some((kind) => prefs.kinds[kind]?.enabled);
  const on = async (kind: ReminderKind, details: Partial<KindPref> = {}) => {
    const answer = await turnOn(b, kind, details, askToNotify, b.registerPush);
    if (answer === "denied") setDenied(true);
  };
  const off = (kind: ReminderKind) => savePrefs(b, { kinds: { [kind]: { enabled: false } } });
  const feed = prefs.kinds.feed_interval, showHours = kinds.includes("feed_interval") && (choosingHours || !!feed?.enabled);
  return <Screen title="Reminders" back>
    <Copy tone="muted">These are yours, on every phone you’re signed in on. Anyone else in your family chooses their own. Reminders also show on Today until you dismiss them.</Copy>
    {/* Says "Saved on this phone" with no signal, and carries her to a change the API refused. */}
    <SyncStatus />
    {denied && anyOn && <View style={{ gap: 8 }}>
      <Notice>Notifications are off for Håfa Baby on this phone, so these only show on Today.</Notice>
      <Row title="Open notification settings" icon="notifications-outline" onPress={() => void Linking.openSettings().catch(() => setOpening("Open your phone’s Settings to change notification permissions."))} />
      {!!opening && <Copy kind="small" tone="muted">{opening}</Copy>}
    </View>}
    <Grouped separatorInset={16}>
      {kinds.map((kind) => <Line key={kind} title={words[kind]!.title} detail={words[kind]!.detail} on={kind === "feed_interval" ? !!feed?.enabled || choosingHours : !!prefs.kinds[kind]?.enabled}
        onChange={(value) => {
          if (kind !== "feed_interval") return void (value ? on(kind) : off(kind));
          // It has no default: on takes effect once she's chosen the hours, or goes back to the hours she chose before.
          if (!value) { setChoosingHours(false); return void off(kind); }
          if (feed?.hours) return void on(kind);
          setChoosingHours(true);
        }} />)}
    </Grouped>
    {showHours && <Section title="Feed reminder">
      <Copy kind="small" tone="muted">How long after the last feed?</Copy>
      <Chips label="Hours after the last feed" value={feed?.enabled && feed.hours ? String(feed.hours) : ""} options={hourChoices.map((value) => ({ label: hourLabel(value), value }))}
        onChange={(value) => {
          setChoosingHours(false);
          if (feed?.enabled) void savePrefs(b, { kinds: { feed_interval: { hours: Number(value) } } });
          else void on("feed_interval", { hours: Number(value) });
        }} />
      {!!feed?.enabled && <Grouped separatorInset={16}><Line title="Also during quiet hours" on={feed.break_through} onChange={(value) => void savePrefs(b, { kinds: { feed_interval: { break_through: value } } })} /></Grouped>}
    </Section>}
    <Section title="Quiet hours">
      <Copy kind="small" tone="muted">Anything that comes up then waits until they end, and is still on Today. A routine you set for a time in quiet hours still goes off at that time.</Copy>
      <Grouped separatorInset={16}><Line title="Quiet hours" on={!!prefs.quiet_hours} onChange={(value) => void savePrefs(b, { quiet_hours: value ? quietWindow(prefs.quiet_hours, zone) : null })} /></Grouped>
      {!!prefs.quiet_hours && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
        <TimeField label="From" value={prefs.quiet_hours.start} onChange={(start) => void savePrefs(b, { quiet_hours: quietWindow(prefs.quiet_hours, zone, { start }) })} />
        <TimeField label="Until" value={prefs.quiet_hours.end} onChange={(end) => void savePrefs(b, { quiet_hours: quietWindow(prefs.quiet_hours, zone, { end }) })} />
      </View>}
    </Section>
    <Grouped><Row title="Lists & routines" detail="Reminders you’ve set on a routine" icon="checkmark-circle-outline" onPress={() => router.push("/routines")} /></Grouped>
  </Screen>;
}
