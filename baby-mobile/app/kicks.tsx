import { useRef } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { kickDetail, openSession, ownSessions, sessionSeconds } from "@/lib/kicks";
import { secondsWords } from "@/lib/contractions";
import { cdcMovementDetail, cdcMovementOpening, cdcMovementSign, cdcWarningSignsSource, cdcWarningSignsUrl } from "@/lib/medical-wording";
import { messageFor } from "@/lib/models";
import { amendCare, careWrite, logCare, undoSaved } from "@/lib/quick-care";
import { friendlyTime } from "@/lib/care-format";
import { profileToday, timingChild } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { Button, Card, Copy, Empty, Grouped, Notice, PressTarget, Row, Screen, Section, fonts, radii, tap, useColors, useToast } from "@/components/ui";
import { useSecondClock } from "@/components/feed-timer";
import { useMinuteClock } from "@/components/care-glance";
import { MedicalSource } from "@/components/medical-source";
import { SyncStatus } from "@/components/sync-status";

/** A tap for each movement, and how long it took. There's no target and no result, because no number is normal. */
export default function Kicks() {
  const b = useBaby(), c = useColors(), toast = useToast(), { fontScale } = useWindowDimensions(), minute = useMinuteClock(),
    timeZone = b.state.bootstrap!.profile.timezone,
    childId = timingChild(b.state, profileToday(minute, timeZone))?.id ?? null,
    care = useTodayCare({ kinds: ["kick_session"], limit: 100 }),
    rows = ownSessions(care.all, childId),
    open = openSession(rows, childId, minute),
    now = useSecondClock(!!open),
    latest = useRef({ open, b }),
    starting = useRef(false);
  latest.current = { open, b };
  /** Each change is built in the write, so taps a moment apart all count. */
  function run(action: () => Promise<unknown>) {
    tap();
    void action().catch((e) => toast(messageFor(e)));
  }
  const count = (by: number, id: string) => amendCare(b, id, (row) => ({ data: { ...row.data, count: Math.max(0, (row.data.count ?? 0) + by) } }));
  const movement = () => {
    if (latest.current.open) return run(() => count(1, latest.current.open!.id));
    // Two taps before the first has saved are one session, not two.
    if (starting.current) return;
    starting.current = true;
    run(() => logCare(b, careWrite("kick_session", childId, { count: 1 }, new Date())).finally(() => { starting.current = false; }));
  };
  // Taking back the only movement takes back the session it began.
  const takeBack = () => open && run(() => (open.data.count ?? 0) > 1 ? count(-1, open.id) : undoSaved(b, open)());
  const finish = () => open && run(() => amendCare(b, open.id, (row) => ({ data: { ...row.data, end_at: new Date().toISOString() } })));
  return <Screen title="Kick counter" back>
    <SyncStatus />
    <PressTarget accessibilityRole="button" accessibilityLabel={`Movement. ${open?.data.count ?? 0} so far`} accessibilityHint="Counts one movement and saves it" onPress={movement}
      style={{ minHeight: 168, borderRadius: radii.card, alignItems: "center", justifyContent: "center", gap: 2, padding: 16, backgroundColor: c.action }}>
      <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.display, fontSize: 64, lineHeight: 72, color: c.onAction, fontVariant: ["tabular-nums"] }}>{open?.data.count ?? 0}</Text>
      <Text key={`m:${fontScale}`} maxFontSizeMultiplier={1.5} style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, color: c.onAction, textAlign: "center" }}>Tap for each movement</Text>
      {!!open && <Text key={`t:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, color: c.onAction, fontVariant: ["tabular-nums"] }}>{secondsWords(sessionSeconds(open, now))}</Text>}
    </PressTarget>
    {!!open && <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 8 }}>
      <View style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? undefined : 0 }}><Button secondary title="Take one back" onPress={takeBack} /></View>
      <View style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? undefined : 0 }}><Button title="Finish" onPress={finish} /></View>
    </View>}
    <Card tone="soft">
      <Copy kind="small">{cdcMovementOpening}</Copy>
      <Copy kind="label">{cdcMovementSign}</Copy>
      <Copy kind="small">{cdcMovementDetail}</Copy>
      <MedicalSource source={cdcWarningSignsSource} url={cdcWarningSignsUrl} />
    </Card>
    {!!care.error && <Notice>Showing what’s on this phone. {care.error}</Notice>}
    {rows.length ? <Section title="History">
      <Grouped>{rows.slice(0, 50).map((row) => <Row key={row.id} numericTitle numericDetail title={friendlyTime(row.occurred_at, minute, timeZone)} detail={kickDetail(row, now)}
        onPress={() => router.push({ pathname: "/record/[id]", params: { id: row.id } })} />)}</Grouped>
    </Section> : <Empty icon="footsteps-outline" title="No sessions yet" body="Your first tap starts a session." />}
  </Screen>;
}
