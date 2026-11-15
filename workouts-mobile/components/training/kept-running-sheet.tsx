import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Copy, Row, Sheet, formatClock } from "@/components/ui";
import { displayedClockSeconds, sessionElapsedMilliseconds, type SessionDraft } from "@/lib/training";

const minute = 60_000;
const timeOfDay = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** Clock text, as the screen shows it, if it had stopped at `at`. */
export function clockAt(d: SessionDraft, at: number) {
  return formatClock(displayedClockSeconds(d, at));
}

/**
 * Shown after the app reopens with a class clock that kept running. Keep is the usual answer: the person
 * kept working while the phone was away. "I stopped earlier" picks the moment, from leaving the app to now.
 */
export function KeptRunningSheet({ d, now, busy, cap, onKeep, onStoppedAt }: {
  d: SessionDraft & { clock_kept_running: { left_at: number } }; now: number; busy: boolean; cap: number | null;
  onKeep(): void; onStoppedAt(at: number): void;
}) {
  const left = d.clock_kept_running.left_at;
  const [choosing, setChoosing] = useState(false);
  const [at, setAt] = useState(left);
  useEffect(() => { setChoosing(false); setAt(left); }, [left]);
  const clock = clockAt(d, now);
  const capped = cap != null && sessionElapsedMilliseconds(d, now) >= cap * 1000;
  const stopAt = Math.min(Math.max(at, left), now);
  return (
    <Sheet visible onClose={onKeep} title="Your clock kept running">
      <Copy kind="numeric" align="center" fit maxScale={1.6} style={{ fontSize: 48, lineHeight: 56 }}>{clock}</Copy>
      <Copy tone="muted" align="center">
        {capped ? `It reached the ${formatClock(cap!)} cap.` : cap != null ? `${d.timed_circuit ? "Time left" : "On the clock"}, of ${formatClock(cap)}.` : "On the clock."}{" "}
        You left Håfa at {timeOfDay(left)}.
      </Copy>
      {choosing ? (
        <View style={{ gap: 12 }}>
          <Copy kind="label">I stopped at</Copy>
          <Row gap={12} align="center" justify="center">
            <Button title="−1 min" variant="secondary" size="sm" inline disabled={busy || stopAt <= left}
              accessibilityLabel="One minute earlier" onPress={() => setAt(Math.max(left, stopAt - minute))} />
            <Copy kind="heading" accessibilityLabel={`Stopped at ${timeOfDay(stopAt)}`}>{timeOfDay(stopAt)}</Copy>
            <Button title="+1 min" variant="secondary" size="sm" inline disabled={busy || stopAt >= now}
              accessibilityLabel="One minute later" onPress={() => setAt(Math.min(now, stopAt + minute))} />
          </Row>
          <Copy kind="small" tone="muted" align="center">The clock will read {clockAt(d, stopAt)} and stay paused.</Copy>
          <Button title={`Stop the clock at ${clockAt(d, stopAt)}`} busy={busy} onPress={() => onStoppedAt(stopAt)} />
          <Button title="Back" variant="ghost" disabled={busy} onPress={() => setChoosing(false)} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Button title={capped ? "Keep my time" : "Keep it running"} icon="checkmark" busy={busy} onPress={onKeep} />
          <Button title="I stopped earlier" variant="secondary" disabled={busy} onPress={() => setChoosing(true)} />
        </View>
      )}
    </Sheet>
  );
}
