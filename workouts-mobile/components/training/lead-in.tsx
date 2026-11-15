import { useEffect, useRef, useState } from "react";
import { Modal, View } from "react-native";
import * as Speech from "expo-speech";
import { Button, Copy, haptics, useColors } from "@/components/ui";
import { announce } from "@/components/training/session-parts";
import { useKeepAwakeWhile } from "@/components/training/keep-awake";

/** Whole seconds left in a countdown that ends at `until`; 0 means go. */
export const leadInSecond = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 1000));

/** 3, 2, 1, GO before a timed part, with a haptic and a spoken word each second. The clock starts at `until`. */
export function LeadIn({ until, label, onSkip, onDone }: { until: number; label: string; onSkip(): void; onDone(): void }) {
  const c = useColors();
  const [now, setNow] = useState(Date.now());
  const second = leadInSecond(until, now);
  const spoken = useRef<number | null>(null);
  useKeepAwakeWhile(true, "lead-in");
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (spoken.current === second) return;
    spoken.current = second;
    const word = second === 0 ? "Go" : String(second);
    if (second === 0) haptics.warning(); else haptics.tick();
    announce(word);
    Speech.speak(word);
    if (second === 0) {
      // Hold "GO" for a beat, then hand over to the running clock.
      const done = setTimeout(onDone, 600);
      return () => clearTimeout(done);
    }
  }, [second]);
  return (
    <Modal visible animationType="fade" onRequestClose={onSkip} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.background, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
        <Copy kind="label" tone="muted" align="center">{label}</Copy>
        <Copy kind="numeric" tone="accent" align="center" allowFontScaling={false}
          accessibilityLabel={second === 0 ? "Go" : `Starting in ${second}`}
          style={{ fontSize: 160, lineHeight: 176 }}>{second === 0 ? "GO" : second}</Copy>
        {/* A real target for a sweaty thumb; the label stays on one line so the icon stays beside it. */}
        <View style={{ alignSelf: "stretch" }}>
          <Button title="Start now" variant="secondary" size="lg" icon="play-skip-forward" maxScale={1.3} onPress={onSkip} />
        </View>
      </View>
    </Modal>
  );
}
