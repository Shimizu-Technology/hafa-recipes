import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBaby } from "@/lib/context";
import { messageFor, type FeedTimer } from "@/lib/models";
import { friendlyTime } from "@/lib/care-format";
import {
  activeMs,
  changeTimer,
  clockText,
  currentSide,
  isPaused,
  pauseTimer,
  resumeTimer,
  spokenTimer,
  switchSide,
} from "@/lib/feed-timer";
import { Button, Card, Copy, fonts, useColors, useToast } from "./ui";

/** Tick once a second only while the timer runs, Today is focused, and the app is in front. */
function useSecondClock(running: boolean) {
  const [now, setNow] = useState(() => new Date()),
    [focused, setFocused] = useState(true),
    [foreground, setForeground] = useState(AppState.currentState !== "background");
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => setForeground(status !== "background"));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!running || !focused || !foreground) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [running, focused, foreground]);
  return now;
}

const sideTitle = { left: "Left side", right: "Right side" } as const;

/** The running breastfeed: one place to switch, pause, finish or discard it. */
export function FeedTimerCard({
  timer,
  childName,
  onDone,
}: {
  timer: FeedTimer;
  childName: string;
  onDone: (timer: FeedTimer) => Promise<void>;
}) {
  const b = useBaby(),
    c = useColors(),
    { fontScale } = useWindowDimensions(),
    toast = useToast(),
    paused = isPaused(timer),
    now = useSecondClock(!paused),
    side = currentSide(timer),
    [busy, setBusy] = useState(false),
    // A ref, not state, so two taps in the same frame cannot both start a write.
    working = useRef(false);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast(messageFor(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const change = (next: (current: FeedTimer) => FeedTimer | undefined) =>
    run(() => b.commit((state) => changeTimer(state, timer.started_at, next)));
  function cancel() {
    Alert.alert("Discard this feeding timer?", "The time so far will not be saved.", [
      { text: "Keep timing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void change(() => undefined) },
    ]);
  }
  return (
    <Card tone="hero">
      <View accessible accessibilityLabel={`Feeding ${childName}. ${spokenTimer(timer, now)}`} style={{ gap: 2 }}>
        <Copy numeric kind="small" tone="muted">
          {`Feeding ${childName} · started ${friendlyTime(timer.started_at, now)}${paused ? " · paused" : ""}`}
        </Copy>
        <Text
          key={fontScale}
          maxFontSizeMultiplier={1.4}
          numberOfLines={1}
          style={{ color: c.text, fontSize: 44, lineHeight: 50, fontFamily: fonts.rounded, fontWeight: "700", fontVariant: ["tabular-nums"] }}
        >
          {clockText(activeMs(timer, now))}
        </Text>
        <Copy kind="small" tone="muted">{sideTitle[side]}</Copy>
      </View>
      <Button icon="stop" title="Stop" busy={busy} onPress={() => void run(() => onDone(timer))} />
      <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 12 }}>
        <View style={{ flexGrow: fontScale >= 1.3 ? 0 : 1, flexBasis: fontScale >= 1.3 ? undefined : 0, minWidth: 0 }}>
          <Button
            secondary
            icon="swap-horizontal"
            title="Switch"
            accessibilityLabel={`Switch to ${side === "left" ? "right" : "left"}`}
            disabled={busy}
            onPress={() => void change((current) => switchSide(current, new Date()))}
          />
        </View>
        <View style={{ flexGrow: fontScale >= 1.3 ? 0 : 1, flexBasis: fontScale >= 1.3 ? undefined : 0, minWidth: 0 }}>
          <Button
            secondary
            icon={paused ? "play" : "pause"}
            title={paused ? "Resume" : "Pause"}
            disabled={busy}
            onPress={() =>
              void change((current) =>
                isPaused(current) ? resumeTimer(current, new Date()) : pauseTimer(current, new Date())
              )
            }
          />
        </View>
      </View>
      <Button variant="ghost" title="Cancel timer" disabled={busy} onPress={cancel} />
    </Card>
  );
}
