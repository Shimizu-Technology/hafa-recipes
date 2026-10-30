/**
 * Animated components using Moti and Reanimated.
 * Provides smooth, performant animations throughout the app.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated as NativeAnimated, Easing as NativeEasing, Platform, Pressable, PressableProps, View, ViewStyle, StyleProp } from 'react-native';
import { MotiView } from 'moti';
import Animated, {
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { listEntranceDelay, MAX_LIST_ENTRANCE_ITEMS } from '@/lib/listAnimation';
import { useReduceMotion } from '@/hooks/useReduceMotion';

export { useInitialListEntrance } from '@/lib/listAnimation';

const AnimatedPressable = NativeAnimated.createAnimatedComponent(Pressable);

// ============================================================
// Staggered List Animation
// ============================================================

const LIST_ENTRANCE_MS = 200;
const LIST_ENTRANCE_OFFSET = 8;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

interface AnimatedListItemProps {
  children: ReactNode;
  index: number;
  delay?: number; // ms delay per item
  style?: StyleProp<ViewStyle>;
  /** Whether this row may play the entrance; decided once when the row mounts. */
  enter?: boolean;
}

/**
 * Wraps a list row with a short staggered fade-up for the first visible rows.
 * Reduce Motion keeps the fade without the slide.
 */
export function AnimatedListItem({
  children,
  index,
  delay = 40,
  style,
  enter = true,
}: AnimatedListItemProps) {
  const [shouldEnter] = useState(() => enter && index < MAX_LIST_ENTRANCE_ITEMS);
  if (!shouldEnter) return <View style={style}>{children}</View>;
  return <EnteringListItem index={index} delay={delay} style={style}>{children}</EnteringListItem>;
}

function EnteringListItem({ children, index, delay, style }: Required<Pick<AnimatedListItemProps, 'index' | 'delay'>> & Pick<AnimatedListItemProps, 'children' | 'style'>) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      listEntranceDelay(index, delay),
      withTiming(1, { duration: LIST_ENTRANCE_MS, easing: EASE_OUT }),
    );
    // Play once per mounted row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * LIST_ENTRANCE_OFFSET }],
  }), [reduceMotion]);

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ============================================================
// Pressable with Scale Animation
// ============================================================

interface ScalePressableProps extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** @deprecated Press feedback uses the same 0.97 scale on every control. */
  scaleValue?: number;
}

/**
 * A pressable that scales down slightly when pressed.
 * Provides visual feedback that complements haptic feedback.
 */
export function ScalePressable({
  children,
  style,
  scaleValue: _scaleValue,
  onPressIn,
  onPressOut,
  ...props
}: ScalePressableProps) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new NativeAnimated.Value(0)).current;
  const animate = (pressed: boolean) => {
    progress.stopAnimation();
    NativeAnimated.timing(progress, {
      toValue: pressed ? 1 : 0,
      duration: pressed ? 120 : 160,
      easing: NativeEasing.bezier(0.23, 1, 0.32, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  useEffect(() => () => progress.stopAnimation(), [progress]);

  return (
    <AnimatedPressable
      {...props}
      style={[
        style,
        {
          opacity: props.disabled ? 0.5 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }),
          transform: [{ scale: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }],
        },
      ]}
      onPressIn={(e) => { if (!props.disabled) animate(true); onPressIn?.(e); }}
      onPressOut={(e) => { animate(false); onPressOut?.(e); }}
    >
      {children}
    </AnimatedPressable>
  );
}

// ============================================================
// Heart Pulse Animation (for Save button)
// ============================================================

interface HeartPulseProps {
  children: ReactNode;
  trigger: boolean; // When this changes to true, pulse
  style?: StyleProp<ViewStyle>;
}

/**
 * Wraps content with a pulse animation.
 * Triggers when `trigger` prop changes to true.
 */
export function PulseOnChange({ 
  children, 
  trigger,
  style,
}: HeartPulseProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Trigger pulse animation
  const triggerPulse = () => {
    scale.value = withSequence(
      withSpring(1.3, { damping: 8, stiffness: 400 }),
      withSpring(1, { damping: 8, stiffness: 400 })
    );
  };

  // Watch for trigger changes
  if (trigger) {
    triggerPulse();
  }

  return (
    <Animated.View style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

// ============================================================
// Fade In View
// ============================================================

interface FadeInViewProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Simple fade-in animation for any content.
 */
export function FadeInView({
  children,
  delay = 0,
  duration = 300,
  style,
}: FadeInViewProps) {
  return (
    <MotiView
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        type: 'timing',
        duration,
        delay,
      }}
      style={style}
    >
      {children}
    </MotiView>
  );
}

// ============================================================
// Slide Up View (for modals, bottom sheets)
// ============================================================

interface SlideUpViewProps {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Slides content up from below with fade.
 * Good for modals and bottom sheets.
 */
export function SlideUpView({
  children,
  delay = 0,
  style,
}: SlideUpViewProps) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 50 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'spring',
        damping: 20,
        stiffness: 300,
        delay,
      }}
      style={style}
    >
      {children}
    </MotiView>
  );
}

// ============================================================
// Bounce View (for emphasis)
// ============================================================

interface BounceViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Bounces in with a spring animation.
 * Good for new items or notifications.
 */
export function BounceView({
  children,
  style,
}: BounceViewProps) {
  return (
    <MotiView
      from={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: 'spring',
        damping: 12,
        stiffness: 200,
      }}
      style={style}
    >
      {children}
    </MotiView>
  );
}

export default {
  AnimatedListItem,
  ScalePressable,
  PulseOnChange,
  FadeInView,
  SlideUpView,
  BounceView,
};
