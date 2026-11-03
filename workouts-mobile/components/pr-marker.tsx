import { useEffect, useRef } from "react";
import { Animated, Easing, Platform } from "react-native";
import type { ExerciseRecord } from "@/lib/progress-insights";
import { Copy, haptics, useReducedMotion } from "./ui";

/** Compare canonical measurements, never reformatted labels or different measures. */
export function PRMarker({ value, measure, active = true }: { value: string; measure: ExerciseRecord["measure"]; active?: boolean }) {
  const reduced = useReducedMotion();
  const previous = useRef(measure);
  const opacity = useRef(new Animated.Value(1)).current;
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const before = previous.current;
    previous.current = measure;
    const improved = before && measure && before.metric === measure.metric &&
      (measure.value > before.value || measure.value === before.value && (measure.reps ?? 0) > (before.reps ?? 0));
    if (!improved) return;
    haptics.success();
    opacity.stopAnimation(); y.stopAnimation();
    opacity.setValue(0.65); y.setValue(reduced ? 0 : -6);
    Animated.timing(opacity, { toValue: 1, duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: Platform.OS !== "web" }).start();
    if (!reduced) Animated.spring(y, { toValue: 0, stiffness: 420, damping: 34, mass: 0.8, useNativeDriver: Platform.OS !== "web" }).start();
  }, [measure, active, reduced, opacity, y]);
  useEffect(() => () => { opacity.stopAnimation(); y.stopAnimation(); }, [opacity, y]);
  return <Animated.View style={{ opacity, transform: [{ translateY: reduced ? 0 : y }] }}>
    <Copy kind="numericSmall" style={{ fontSize: 17, lineHeight: 24 }}>{value}</Copy>
  </Animated.View>;
}
