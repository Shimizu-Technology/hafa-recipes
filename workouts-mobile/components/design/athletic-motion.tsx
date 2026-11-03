import { useEffect, useRef, type PropsWithChildren } from "react";
import { Animated, Easing, Platform } from "react-native";
import { useMotionPreference, useReducedMotion } from "./foundation";

const native = Platform.OS !== "web";
const easeOut = (t: number) => Easing.bezier(0.23, 1, 0.32, 1)(t);

/** Only the first viewport enters; later filtering and scrolling never replay it. */
export function Entrance({ children, index = 0 }: PropsWithChildren<{ index?: number }>) {
  const reduced = useMotionPreference();
  const value = useRef(new Animated.Value(0)).current;
  const entranceMotion = useRef<boolean | null>(null);
  useEffect(() => {
    if (reduced == null) return;
    entranceMotion.current ??= !reduced;
    const animation = Animated.timing(value, { toValue: 1, duration: reduced ? 180 : 240,
      delay: reduced ? 0 : Math.min(index, 5) * 40, easing: easeOut, useNativeDriver: native });
    animation.start();
    return () => animation.stop();
  }, [reduced, index, value]);
  useEffect(() => () => value.stopAnimation(), [value]);
  return <Animated.View style={{ opacity: value, transform: [{ translateY: reduced !== false || entranceMotion.current === false ? 0 : value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>{children}</Animated.View>;
}

/** Set-complete feedback, paired with the player's existing successful-log haptic. */
export function SetPop({ children, trigger }: PropsWithChildren<{ trigger: unknown }>) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const previous = useRef(trigger);
  useEffect(() => {
    if (previous.current === trigger) return;
    previous.current = trigger;
    scale.stopAnimation(); opacity.stopAnimation();
    if (reduced) {
      scale.setValue(1); opacity.setValue(0.65);
      Animated.timing(opacity, { toValue: 1, duration: 180, easing: easeOut, useNativeDriver: native }).start();
    } else {
      opacity.setValue(1); scale.setValue(1.08);
      Animated.spring(scale, { toValue: 1, stiffness: 340, damping: 24, mass: 0.9, useNativeDriver: native }).start();
    }
    // Preference changes must not stop a fade halfway. Cleanup belongs to unmount.
  }, [trigger, reduced, scale, opacity]);
  useEffect(() => () => { scale.stopAnimation(); opacity.stopAnimation(); }, [scale, opacity]);
  return <Animated.View style={{ opacity, transform: [{ scale: reduced ? 1 : scale }] }}>{children}</Animated.View>;
}

export type EntranceBudget = { ids: string[] | null; seen: Set<string> };
export function EntranceItem({ children, id, budget }: PropsWithChildren<{ id: string; budget: EntranceBudget }>) {
  const first = useRef<boolean | null>(null);
  if (first.current === null) { first.current = !!budget.ids?.includes(id) && !budget.seen.has(id); budget.seen.add(id); }
  return first.current ? <Entrance index={budget.ids?.indexOf(id) ?? 0}>{children}</Entrance> : <>{children}</>;
}
