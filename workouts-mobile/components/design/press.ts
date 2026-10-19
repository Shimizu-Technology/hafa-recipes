import { useCallback, useRef } from "react";
import { Animated, Easing, Platform, Pressable } from "react-native";
import { motion } from "@/constants/theme";
import { useReducedMotion } from "./foundation";

let animatedPressable: Animated.AnimatedComponent<typeof Pressable> | null = null;
/** Pressable that accepts Animated styles. Created on first use so importing this module stays cheap. */
export function animatedPressableComponent() {
  return (animatedPressable ??= Animated.createAnimatedComponent(Pressable));
}

/**
 * Shared press feedback: scale to 0.97 on press-in (120ms), release in 160ms,
 * with a strong ease-out on the native driver. Under Reduce Motion nothing
 * moves; the control dims while held instead.
 */
export function usePressScale(disabled = false) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const animate = useCallback(
    (toValue: number, duration: number) => {
      if (reduced) {
        scale.setValue(1);
        opacity.setValue(toValue === 1 ? 1 : 0.8);
        return;
      }
      Animated.timing(scale, {
        toValue,
        duration,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        useNativeDriver: Platform.OS !== "web",
      }).start();
    },
    [reduced, scale, opacity]
  );
  const onPressIn = useCallback(() => {
    if (!disabled) animate(motion.pressScale, motion.fast);
  }, [animate, disabled]);
  const onPressOut = useCallback(() => animate(1, motion.pressOut), [animate]);
  return { onPressIn, onPressOut, scale, opacity };
}
