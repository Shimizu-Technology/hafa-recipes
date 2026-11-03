import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, View, type ViewStyle } from "react-native";
import { useLook } from "@/lib/look-context";
import { tap } from "@/components/ui";

/** Strong ease-out (research §2a EASE.out); never ease-in for UI. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const native = Platform.OS !== "web";

/** Reduce Motion, read once at start and kept current by the system event. */
let reduced = false;
export function primeReduceMotion() {
  void AccessibilityInfo.isReduceMotionEnabled().then((value) => { reduced = value; }).catch(() => undefined);
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => { reduced = value; });
  return () => subscription.remove();
}
export function reduceMotion() {
  return reduced;
}

/** A spring with Apple-style perceptual duration and damping ratio (mass 1). */
export function spring(value: Animated.Value, toValue: number, durationMs: number, dampingRatio: number) {
  const stiffness = (2 * Math.PI / (durationMs / 1000)) ** 2, damping = 2 * Math.sqrt(stiffness) * dampingRatio;
  return Animated.spring(value, { toValue, stiffness, damping, mass: 1, useNativeDriver: native });
}

/**
 * First-mount list entrance: the first six rows fade up with a short stagger, only while their list is new.
 * Rows added later (a filter, a sync, a scroll) appear at once. Reduce Motion keeps a 180ms fade.
 */
export function Entrance({ index, born, style, children }: { index: number; born?: number; style?: ViewStyle; children: ReactNode }) {
  const entrance = useLook().look.motion.entrance;
  const [play] = useState(() => !!entrance && index < 6 && Date.now() - (born ?? Date.now()) < 700);
  const value = useRef(new Animated.Value(play ? 0 : 1)).current, still = reduceMotion();
  useEffect(() => {
    if (!play || !entrance) return;
    Animated.timing(value, { toValue: 1, duration: still ? 180 : entrance.durationMs, delay: still ? 0 : index * entrance.staggerMs,
      easing: EASE_OUT, useNativeDriver: native }).start();
  }, []);
  if (!play || !entrance) return style ? <View style={style}>{children}</View> : <>{children}</>;
  return <Animated.View style={{ ...style, opacity: value,
    transform: still ? [] : [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [entrance.offset, 0] }) }] }}>
    {children}
  </Animated.View>;
}

/** One fade-up on mount (Soft's hero: 320ms). */
export function FadeUp({ durationMs = 320, offset = 12, delay = 0, style, children }: { durationMs?: number; offset?: number; delay?: number; style?: ViewStyle; children: ReactNode }) {
  const value = useRef(new Animated.Value(0)).current, still = reduceMotion();
  useEffect(() => {
    Animated.timing(value, { toValue: 1, duration: still ? 180 : durationMs, delay: still ? 0 : delay, easing: EASE_OUT, useNativeDriver: native }).start();
  }, []);
  return <Animated.View style={[style, { opacity: value,
    transform: still ? [] : [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }] }]}>{children}</Animated.View>;
}

/**
 * The signature confirmation when a tip is filed under a topic, played once with a success haptic after the
 * category sheet has slid away (~380ms), so it is actually seen.
 * Soft: a gentle 1.03 swell. Scrapbook: a pin-drop (drops 10pt, scale 1.06 → 1, rotate 2° → 0, taped). Warm: a small bouncy pop.
 */
export function SavedMoment({ children }: { children: ReactNode }) {
  const id = useLook().look.id, value = useRef(new Animated.Value(0)).current, still = reduceMotion();
  useEffect(() => {
    const timer = setTimeout(() => {
      tap("success");
      if (still) { Animated.timing(value, { toValue: 1, duration: 180, useNativeDriver: native }).start(); return; }
      if (id === "soft") Animated.sequence([
        Animated.timing(value, { toValue: 0.5, duration: 180, easing: EASE_OUT, useNativeDriver: native }),
        Animated.timing(value, { toValue: 1, duration: 280, easing: EASE_OUT, useNativeDriver: native }),
      ]).start();
      else spring(value, 1, id === "scrapbook" ? 450 : 400, 0.7).start();
    }, 380);
    return () => clearTimeout(timer);
  }, []);
  const opacity = value.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: "clamp" });
  const transform = still ? [] : id === "soft"
    ? [{ scale: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.03, 1] }) }]
    : id === "scrapbook"
      ? [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
        { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) },
        { rotate: value.interpolate({ inputRange: [0, 1], outputRange: ["2deg", "0deg"] }) }]
      : [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }];
  return <Animated.View style={{ opacity: !still && id === "soft" ? 1 : opacity, transform }}>
    {children}
    {id === "scrapbook" && <View pointerEvents="none" style={{ position: "absolute", top: -7, left: 24, width: 64, height: 16, borderRadius: 2,
      backgroundColor: "#E8CF9C", opacity: 0.85, transform: [{ rotate: "-4deg" }] }} />}
  </Animated.View>;
}
