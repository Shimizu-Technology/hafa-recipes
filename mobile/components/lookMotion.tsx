/**
 * Motion for the design-preview looks, on React Native's Animated (native driver) so the shared
 * chrome can use it without pulling Reanimated into every screen. Only the preview branches call these.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useLook } from '@/contexts/LookContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';

// Created on first use so modules that import this file never touch Animated at load time.
let easeOut: ReturnType<typeof Easing.bezier> | undefined;
const EASE_OUT = (t: number) => (easeOut ??= Easing.bezier(0.23, 1, 0.32, 1))(t);
let AnimatedPressable: Animated.AnimatedComponent<typeof Pressable> | undefined;
const animatedPressable = () => (AnimatedPressable ??= Animated.createAnimatedComponent(Pressable));

/** Reanimated-style duration spring (perceptual response in ms, damping ratio) as RN physics. */
export function springFor(duration: number, dampingRatio: number) {
  const response = duration / 1000;
  return { stiffness: (2 * Math.PI / response) ** 2, damping: (4 * Math.PI * dampingRatio) / response, mass: 1 };
}

/** The look's press: scale and opacity in on press, faster back out. Reduce Motion keeps the opacity only. */
export function LookPressable({ children, style, onPressIn, onPressOut, ...props }: Omit<PressableProps, 'style'> & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { press } = useLook().motion;
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const animate = (pressed: boolean) => {
    progress.stopAnimation();
    Animated.timing(progress, { toValue: pressed ? 1 : 0, duration: pressed ? press.inMs : press.outMs, easing: EASE_OUT, useNativeDriver: true }).start();
  };
  const Target = animatedPressable();
  return <Target {...props}
    onPressIn={event => { if (!props.disabled) animate(true); onPressIn?.(event); }}
    onPressOut={event => { animate(false); onPressOut?.(event); }}
    style={[style, {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, press.opacity] }),
      transform: [{ scale: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, press.scale] }) }],
    }]}>{children}</Target>;
}

/** A selection indicator's x: the look's ~300ms spring; placed without motion on first layout and under Reduce Motion. */
export function useIndicatorX(x: number) {
  const reduceMotion = useReduceMotion();
  const { indicator } = useLook().motion;
  const value = useRef(new Animated.Value(x)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!placed.current || reduceMotion || indicator.duration === 0) {
      value.setValue(x);
      if (x > 0) placed.current = true;
      return;
    }
    Animated.spring(value, { toValue: x, useNativeDriver: true, ...springFor(indicator.duration, indicator.dampingRatio) }).start();
  }, [x, reduceMotion, indicator.duration, indicator.dampingRatio, value]);
  return value;
}

/** Fades a block up once on mount, staggered 40ms by `index`. Reduce Motion: a 180ms fade, no slide or stagger. */
export function FadeUp({ index, enabled, children, style }: { index: number; enabled: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [play] = useState(enabled);
  // Current and the other looks render a plain view, with no animation machinery.
  if (!play) return <View style={style}>{children}</View>;
  return <FadeUpPlaying index={index} style={style}>{children}</FadeUpPlaying>;
}

function FadeUpPlaying({ index, children, style }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, delay: reduceMotion ? 0 : index * 40, duration: reduceMotion ? 180 : 280, easing: EASE_OUT, useNativeDriver: true }).start();
    // Plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[style, {
    opacity: progress,
    transform: [{ translateY: reduceMotion ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  }]}>{children}</Animated.View>;
}
