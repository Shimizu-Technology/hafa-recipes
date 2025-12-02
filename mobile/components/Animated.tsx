/**
 * Animated components using Moti and Reanimated.
 * Provides smooth, performant animations throughout the app.
 */

import { ReactNode } from 'react';
import { Pressable, PressableProps, ViewStyle, StyleProp } from 'react-native';
import { MotiView } from 'moti';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ============================================================
// Staggered List Animation
// ============================================================

interface AnimatedListItemProps {
  children: ReactNode;
  index: number;
  delay?: number; // ms delay per item
  style?: StyleProp<ViewStyle>;
}

/**
 * Wraps a list item with staggered fade-in animation.
 * Items fade in and slide up with a delay based on their index.
 */
export function AnimatedListItem({ 
  children, 
  index, 
  delay = 50,
  style,
}: AnimatedListItemProps) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 15 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: 350,
        delay: index * delay,
      }}
      style={style}
    >
      {children}
    </MotiView>
  );
}

// ============================================================
// Pressable with Scale Animation
// ============================================================

interface ScalePressableProps extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleValue?: number; // How much to scale down (default 0.97)
}

/**
 * A pressable that scales down slightly when pressed.
 * Provides visual feedback that complements haptic feedback.
 */
export function ScalePressable({
  children,
  style,
  scaleValue = 0.97,
  onPressIn,
  onPressOut,
  ...props
}: ScalePressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (e: any) => {
    scale.value = withSpring(scaleValue, { damping: 15, stiffness: 400 });
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      style={[style, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...props}
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

