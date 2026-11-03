import { useEffect, useRef, type PropsWithChildren } from "react";
import { Animated, Easing, Platform } from "react-native";
import { useLook } from "@/lib/look-context";
import { useReducedMotion } from "./foundation";
export const EASE = { out: (t: number) => Easing.bezier(0.23, 1, 0.32, 1)(t), inOut: (t: number) => Easing.bezier(0.77, 0, 0.175, 1)(t), sheet: (t: number) => Easing.bezier(0.32, 0.72, 0, 1)(t) };
// RN physics equivalents, tuned for a short, restrained indicator glide.
export const SPRING = { smooth: { stiffness: 240, damping: 31, mass: 1 }, snappy: { stiffness: 420, damping: 34, mass: 0.8 }, bouncy: { stiffness: 340, damping: 24, mass: 0.9 } };
export const PRESS = { scale: 0.97, inMs: 100, outMs: 160 };
const native = Platform.OS !== "web";
/** A screen owns one budget; filtering or mounting later rows cannot replay the entrance. */
export function LookEntrance({ children, index = 0, weekDot = false }: PropsWithChildren<{ index?: number; weekDot?: boolean }>) {
  const look = useLook(), reduced = useReducedMotion(true);
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: 1, duration: reduced ? 180 : look.motion.entrance, delay: reduced ? 0 : weekDot ? index * 60 : Math.min(index, 5) * look.motion.stagger, easing: EASE.out, useNativeDriver: native });
    animation.start(); return () => animation.stop();
  }, [value, reduced, index, look.motion.entrance, look.motion.stagger, weekDot]);
  if (look.id === "current") return <>{children}</>;
  return <Animated.View style={{ opacity: value, transform: [{ translateY: reduced ? 0 : value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>{children}</Animated.View>;
}
/** Deliberate saved-state feedback. Never plays on the initial value or before persistence. */
export function LookPop({ children, trigger, kind = "set" }: PropsWithChildren<{ trigger: unknown; kind?: "set" | "pr" | "completion" }>) {
  const look = useLook(), reduced = useReducedMotion(true);
  const scale = useRef(new Animated.Value(1)).current, opacity = useRef(new Animated.Value(1)).current;
  const previous = useRef(trigger);
  useEffect(() => {
    if (previous.current === trigger) { scale.setValue(1); opacity.setValue(1); return; }
    previous.current = trigger;
    if (look.id === "current" || kind === "pr" && look.id !== "pro") return;
    scale.stopAnimation(); opacity.stopAnimation();
    if (reduced) { scale.setValue(1); opacity.setValue(0.65); Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: native }).start(); }
    else { scale.setValue(look.id === "athletic" ? 1.08 : 1.04); Animated.spring(scale, { toValue: 1, ...SPRING.bouncy, useNativeDriver: native }).start(); }
    return () => { scale.stopAnimation(); opacity.stopAnimation(); };
  }, [trigger, kind, look.id, reduced, scale, opacity]);
  return <Animated.View style={{ opacity, transform: [{ scale }] }}>{children}</Animated.View>;
}

export type EntranceBudget = { ids: string[] | null; seen: Set<string> };
export function LookListItem({ children, id, budget }: PropsWithChildren<{ id: string; budget: EntranceBudget }>) {
  const look = useLook();
  const first = useRef<boolean | null>(null);
  if (first.current === null) {
    first.current = look.id !== "current" && !!budget.ids?.includes(id) && !budget.seen.has(id);
    budget.seen.add(id);
  }
  return first.current ? <LookEntrance index={budget.ids?.indexOf(id) ?? 0}>{children}</LookEntrance> : <>{children}</>;
}
