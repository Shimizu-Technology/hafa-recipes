/**
 * Haptic feedback utilities for tactile responses.
 * Wraps expo-haptics for easy, consistent usage throughout the app.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Only trigger haptics on iOS (Android support is limited)
const isHapticsSupported = Platform.OS === 'ios';

/**
 * Light impact - for general taps, navigation
 */
export const lightHaptic = () => {
  if (isHapticsSupported) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
};

/**
 * Medium impact - for confirmations, toggles
 */
export const mediumHaptic = () => {
  if (isHapticsSupported) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
};

/**
 * Heavy impact - for significant actions, long press
 */
export const heavyHaptic = () => {
  if (isHapticsSupported) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }
};

/**
 * Success notification - for completed actions
 */
export const successHaptic = () => {
  if (isHapticsSupported) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
};

/**
 * Warning notification - for destructive actions
 */
export const warningHaptic = () => {
  if (isHapticsSupported) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
};

/**
 * Error notification - for failed actions
 */
export const errorHaptic = () => {
  if (isHapticsSupported) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
};

/**
 * Selection changed - for picker/selection changes
 */
export const selectionHaptic = () => {
  if (isHapticsSupported) {
    Haptics.selectionAsync();
  }
};

// Convenience object for importing
export const haptics = {
  light: lightHaptic,
  medium: mediumHaptic,
  heavy: heavyHaptic,
  success: successHaptic,
  warning: warningHaptic,
  error: errorHaptic,
  selection: selectionHaptic,
};

export default haptics;

