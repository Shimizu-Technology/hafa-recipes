/**
 * Chrome motion on React Native's Animated (native driver): the shared press and the sliding
 * selection marker used by the tab bar and the segmented control.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';

// Created on first use so importing this file never touches Animated at load time.
let easeOut: ((t: number) => number) | undefined;
const EASE_OUT = (t: number) => (easeOut ??= Easing.bezier(0.23, 1, 0.32, 1))(t);
let AnimatedPressable: Animated.AnimatedComponent<typeof Pressable> | undefined;
const animatedPressable = () => (AnimatedPressable ??= Animated.createAnimatedComponent(Pressable));

/** Press: scale 0.97 and opacity 0.85, 100ms in and 160ms out. Reduce Motion keeps the opacity only. */
export const PRESS = { scale: 0.97, opacity: 0.85, inMs: 100, outMs: 160 } as const;
/** Indicator spring: about 300ms, critically damped. */
const INDICATOR = { stiffness: (2 * Math.PI / 0.3) ** 2, damping: (4 * Math.PI) / 0.3, mass: 1 };

export function PressScale({ children, style, onPressIn, onPressOut, ...props }: Omit<PressableProps, 'style'> & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const animate = (pressed: boolean) => {
    progress.stopAnimation();
    Animated.timing(progress, { toValue: pressed ? 1 : 0, duration: pressed ? PRESS.inMs : PRESS.outMs, easing: EASE_OUT, useNativeDriver: true }).start();
  };
  const Target = animatedPressable();
  return <Target {...props}
    onPressIn={event => { if (!props.disabled) animate(true); onPressIn?.(event); }}
    onPressOut={event => { animate(false); onPressOut?.(event); }}
    style={[style, {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, PRESS.opacity] }),
      transform: [{ scale: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, PRESS.scale] }) }],
    }]}>{children}</Target>;
}

/** A selection marker's x: springs to each new position; placed without motion on first layout and under Reduce Motion. */
export function useIndicatorX(x: number) {
  const reduceMotion = useReduceMotion();
  const value = useRef(new Animated.Value(x)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!placed.current || reduceMotion) {
      value.setValue(x);
      if (x > 0) placed.current = true;
      return;
    }
    Animated.spring(value, { toValue: x, useNativeDriver: true, ...INDICATOR }).start();
  }, [x, reduceMotion, value]);
  return value;
}
