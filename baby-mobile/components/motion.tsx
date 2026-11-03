import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Platform, type ViewStyle } from "react-native";
import { easeOut, tap } from "./ui";

const native = Platform.OS !== "web";

/** Reduce Motion, kept current while mounted; null until the system answers. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => { if (active) setReduced(false); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

/**
 * Soft's entrance for Today's hero: a 320ms fade up from 14pt. Under Reduce Motion only a 180ms fade remains.
 * The offset holds until the preference is known, so a reduced-motion phone never sees it move.
 */
export function FadeUp({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const reduced = useReducedMotion(), value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === null) return;
    Animated.timing(value, { toValue: 1, duration: reduced ? 180 : 320, easing: easeOut, useNativeDriver: native }).start();
  }, [reduced, value]);
  return <Animated.View style={[style, { opacity: value,
    transform: reduced === false ? [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] : [] }]}>
    {children}
  </Animated.View>;
}

/**
 * Soft's signature when a tip is filed under a topic: after the category sheet has slid away (~380ms), the
 * confirmation swells to 1.03 and settles with a success haptic. Under Reduce Motion only the haptic plays.
 */
export function Swell({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion(), value = useRef(new Animated.Value(0)).current, played = useRef(false);
  useEffect(() => {
    if (reduced === null) return;
    // Turning Reduce Motion on mid-swell settles it at rest at once; the haptic never plays twice.
    if (played.current) { if (reduced) { value.stopAnimation(); value.setValue(1); } return; }
    let swell: Animated.CompositeAnimation | null = null;
    const timer = setTimeout(() => {
      played.current = true;
      tap("success");
      if (reduced) return;
      swell = Animated.sequence([
        Animated.timing(value, { toValue: 0.5, duration: 180, easing: easeOut, useNativeDriver: native }),
        Animated.timing(value, { toValue: 1, duration: 280, easing: easeOut, useNativeDriver: native }),
      ]);
      swell.start();
    }, 380);
    return () => { clearTimeout(timer); swell?.stop(); };
  }, [reduced, value]);
  return <Animated.View style={reduced === false ? { transform: [{ scale: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.03, 1] }) }] } : undefined}>
    {children}
  </Animated.View>;
}
