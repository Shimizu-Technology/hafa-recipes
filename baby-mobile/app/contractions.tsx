import { useRef } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { contractionDetail, hourLine, lastHour, ownContractions, runningContraction, secondsWords, withGaps } from "@/lib/contractions";
import { messageFor } from "@/lib/models";
import { cdcWarningSignsLine, cdcWarningSignsSource, cdcWarningSignsUrl, contractionGuidance } from "@/lib/medical-wording";
import { careWrite, logCare, updateCare } from "@/lib/quick-care";
import { friendlyTime } from "@/lib/care-format";
import { pregnancyProgress, profileToday, timingChild } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { Copy, Empty, Grouped, Notice, PressTarget, Row, Screen, Section, fonts, radii, tap, typeScale, useColors, useToast } from "@/components/ui";
import { useSecondClock } from "@/components/feed-timer";
import { useMinuteClock } from "@/components/care-glance";
import { DoctorNote } from "@/components/doctor-note";
import { MedicalSource } from "@/components/medical-source";
import { SyncStatus } from "@/components/sync-status";

/** One big target, half asleep and mid-contraction: the first tap starts the clock, the next stops it. Each one saves. */
export default function Contractions() {
  const b = useBaby(), c = useColors(), toast = useToast(), { fontScale } = useWindowDimensions(), minute = useMinuteClock(),
    timeZone = b.state.bootstrap!.profile.timezone,
    today = profileToday(minute, timeZone),
    child = timingChild(b.state, today),
    childId = child?.id ?? null,
    care = useTodayCare({ kinds: ["contraction"], limit: 100 }),
    rows = ownContractions(care.all, childId),
    running = runningContraction(rows, childId, minute),
    now = useSecondClock(!!running),
    writing = useRef(false),
    guidance = contractionGuidance(child?.due_date ? pregnancyProgress(child.due_date, today)?.week : undefined);
  async function save(action: () => Promise<() => Promise<unknown>>, message: string) {
    if (writing.current) return;
    writing.current = true;
    try {
      const undo = await action();
      tap("success");
      toast(message, { label: "Undo", onPress: async () => { try { await undo(); toast("Undone."); } catch (e) { toast(messageFor(e)); } } });
    } catch (e) { toast(messageFor(e)); }
    finally { writing.current = false; }
  }
  const toggle = () => running
    ? save(() => updateCare(b, running, { ...running.data, end_at: new Date().toISOString() }), "Stopped")
    : save(() => logCare(b, careWrite("contraction", childId, {}, new Date())), "Started");
  const elapsed = running ? secondsWords((now.getTime() - new Date(running.occurred_at).getTime()) / 1000) : "";
  return <Screen title="Contractions" back>
    <SyncStatus />
    <DoctorNote childId={childId} />
    <PressTarget accessibilityRole="button" accessibilityLabel={running ? `Stop. Timing, started ${friendlyTime(running.occurred_at, minute, timeZone)}` : "Start"} accessibilityHint="Saves straight away" onPress={() => void toggle()}
      style={{ minHeight: 148, borderRadius: radii.card, alignItems: "center", justifyContent: "center", gap: 4, padding: 16, backgroundColor: c.action }}>
      <Text key={fontScale} maxFontSizeMultiplier={1.5} style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 48, color: c.onAction }}>{running ? "Stop" : "Start"}</Text>
      {!!running && <Text key={`t:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, color: c.onAction, fontVariant: ["tabular-nums"] }}>{elapsed}</Text>}
    </PressTarget>
    <Copy numeric kind="label">{hourLine(lastHour(rows, now))}</Copy>
    {!!guidance && <Notice>{guidance}</Notice>}
    {!!care.error && <Notice>Showing what’s on this phone. {care.error}</Notice>}
    {rows.length ? <Section title="Recent">
      <Grouped>{withGaps(rows).slice(0, 30).map(({ record, apart }) => <Row key={record.id} numericTitle numericDetail title={friendlyTime(record.occurred_at, minute, timeZone)}
        detail={[contractionDetail(record, now), apart === undefined ? "" : `${secondsWords(apart)} apart`].filter(Boolean).join(" · ")}
        onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })} />)}</Grouped>
    </Section> : <Empty icon="pulse-outline" title="Nothing timed yet" body="Tap Start when one begins, and Stop when it ends." />}
    <View style={{ gap: 2 }}>
      <Copy kind="small" tone="muted">{cdcWarningSignsLine}</Copy>
      <MedicalSource source={cdcWarningSignsSource} url={cdcWarningSignsUrl} />
    </View>
  </Screen>;
}
