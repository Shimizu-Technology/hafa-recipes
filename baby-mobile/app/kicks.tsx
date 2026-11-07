import { HealthNote } from "../components/health-note";
import { useRef } from "react";
import * as Crypto from "expo-crypto";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { kickDetail, openSessions, ownSessions, sessionSeconds } from "@/lib/kicks";
import { secondsWords } from "@/lib/contractions";
import { cdcMovementDetail, cdcMovementOpening, cdcMovementSign, cdcWarningSignsSource, cdcWarningSignsUrl, cdcReuseNote } from "@/lib/medical-wording";
import { messageFor, type BabyRecord } from "@/lib/models";
import { careWrite, logCare, queueSessionAction, undoSaved } from "@/lib/quick-care";
import { reduceSession } from "@/lib/session-actions";
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
    care = useTodayCare({ kinds: ["kick_session"], limit: 100, child: childId }),
    rows = ownSessions(care.all, childId),
    now = useSecondClock(true),
    [open, ...others] = openSessions(rows, childId, now),
    latest = useRef({ open }),
    // The session the first tap began, from that tap until it's on screen. Taps meanwhile are queued behind its create.
    reserved = useRef<string | null>(null);
  latest.current = { open };
  if (rows.some((row) => row.id === reserved.current)) reserved.current = null;
  /** Each tap is its own durable change, so taps a moment apart and taps on another phone all count. */
  function run(action: () => Promise<unknown>) {
    tap();
    void action().catch((e) => toast(messageFor(e)));
  }
  const movement = () => {
    const at = new Date(), session = reserved.current ?? latest.current.open?.id;
    if (session) return run(() => queueSessionAction(b, session, { action: "tap", at: at.toISOString() }));
    const record = careWrite("kick_session", childId, { count: 1, session_actions: [{ id: Crypto.randomUUID(), action: "tap", at: at.toISOString() }] }, at);
    reserved.current = record.id;
    run(() => logCare(b, record).catch((e) => { reserved.current = null; throw e; }));
  };
  const takeBack = () => {
    if (!open) return;
    const { taps } = reduceSession(open.data.session_actions), last = taps[taps.length - 1];
    // Taking back the only movement takes back the session it began.
    run(() => (taps.length > 1 ? queueSessionAction(b, open.id, { action: "undo", target: last.id, at: new Date().toISOString() }) : undoSaved(b, open)()));
  };
  const finish = (session: BabyRecord) => run(() => queueSessionAction(b, session.id, { action: "finish", at: new Date().toISOString() }));
  return <Screen title="Kick counter" back>
    <Notice>Baby moving less or stopped? Seek medical care immediately. Don’t wait to finish a count.</Notice>
    <Button title="Open Help" onPress={() => router.push("/help")} />
    <SyncStatus />
    <PressTarget accessibilityRole="button" accessibilityLabel={`Movement. ${open?.data.count ?? 0} so far`} accessibilityHint="Counts one movement and saves it" onPress={movement}
      style={{ minHeight: 168, borderRadius: radii.card, alignItems: "center", justifyContent: "center", gap: 2, padding: 16, backgroundColor: c.action }}>
      <Text key={fontScale} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.display, fontSize: 64, lineHeight: 72, color: c.onAction, fontVariant: ["tabular-nums"] }}>{open?.data.count ?? 0}</Text>
      <Text key={`m:${fontScale}`} maxFontSizeMultiplier={1.5} style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, color: c.onAction, textAlign: "center" }}>Tap for each movement</Text>
      {!!open && <Text key={`t:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, color: c.onAction, fontVariant: ["tabular-nums"] }}>{secondsWords(sessionSeconds(open, now))}</Text>}
    </PressTarget>
    {!!open && <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 8 }}>
      <View style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? undefined : 0 }}><Button secondary title="Take one back" onPress={takeBack} /></View>
      <View style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? undefined : 0 }}><Button title="Finish" onPress={() => finish(open)} /></View>
    </View>}
    {others.map((row) => <Card key={row.id} tone="soft">
      <Copy kind="label">Another session is still open</Copy>
      <Copy numeric kind="small" tone="muted">{`${friendlyTime(row.occurred_at, minute, timeZone)} · ${kickDetail(row, now)}`}</Copy>
      <Button secondary title="Finish this one" onPress={() => finish(row)} />
    </Card>)}
    <Card tone="soft">
      <Copy kind="small">{cdcMovementOpening}</Copy>
      <Copy kind="label">{cdcMovementSign}</Copy>
      <Copy kind="small">{cdcMovementDetail}</Copy>
      <MedicalSource source={cdcWarningSignsSource} url={cdcWarningSignsUrl} />
      <Copy kind="small" tone="muted">{cdcReuseNote}</Copy>
    </Card>
    {/* Being offline already has its one calm line, up top. */}
    {!!care.error && b.online !== false && !b.unreachable && <Notice>Showing what’s on this phone. {care.error}</Notice>}
    {rows.length ? <Section title="History">
      <Grouped>{rows.slice(0, 50).map((row) => <Row key={row.id} numericTitle numericDetail title={friendlyTime(row.occurred_at, minute, timeZone)} detail={kickDetail(row, now)}
        onPress={() => router.push({ pathname: "/record/[id]", params: { id: row.id } })} />)}</Grouped>
    </Section> : <Empty icon="footsteps-outline" title="No sessions yet" body="Your first tap starts a session." />}
    <Copy kind="small">This records movements; it cannot tell you your baby is okay. Ask your doctor whether and how to count.</Copy>
    <HealthNote />
  </Screen>;
}
