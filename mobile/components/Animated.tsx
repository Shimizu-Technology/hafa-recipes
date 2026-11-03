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
import { useLook } from '@/contexts/LookContext';

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
  const look = useLook();
  // Each design-preview look sets its own entrance; Current keeps the shipped 200ms/8pt/first-8 values.
  const entrance = look.id === 'current'
    ? { duration: LIST_ENTRANCE_MS, stagger: delay, offset: LIST_ENTRANCE_OFFSET, max: MAX_LIST_ENTRANCE_ITEMS }
    : look.motion.entrance;
  const [shouldEnter] = useState(() => enter && index < entrance.max);
  if (!shouldEnter) return <View style={style}>{children}</View>;
  return <EnteringListItem index={index} delay={entrance.stagger} duration={entrance.duration} offset={entrance.offset}
    lookPreview={look.id !== 'current'} style={style}>{children}</EnteringListItem>;
}

function EnteringListItem({ children, index, delay, duration = LIST_ENTRANCE_MS, offset = LIST_ENTRANCE_OFFSET, lookPreview = false, style }: Required<Pick<AnimatedListItemProps, 'index' | 'delay'>> & Pick<AnimatedListItemProps, 'children' | 'style'> & { duration?: number; offset?: number; lookPreview?: boolean }) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      // Preview looks: Reduce Motion keeps a plain fade with no stagger or slide.
      lookPreview ? (reduceMotion ? 0 : listEntranceDelay(index, delay, delay * 6)) : listEntranceDelay(index, delay),
      withTiming(1, { duration: lookPreview && reduceMotion ? Math.min(duration, 180) : duration, easing: EASE_OUT }),
    );
    // Play once per mounted row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * offset }],
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
  const press = useLook().motion.press;
  const progress = useRef(new NativeAnimated.Value(0)).current;
  const animate = (pressed: boolean) => {
    progress.stopAnimation();
    NativeAnimated.timing(progress, {
      toValue: pressed ? 1 : 0,
      duration: pressed ? press.inMs : press.outMs,
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
          opacity: props.disabled ? 0.5 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, press.opacity] }),
          transform: [{ scale: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, press.scale] }) }],
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
