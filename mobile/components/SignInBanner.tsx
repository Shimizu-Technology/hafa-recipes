import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/components/Themed';
import { radius, spacing, typography } from '@/constants/Colors';

interface SignInBannerProps {
  message?: string;
  onSignIn?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Guest account prompt shown inline at the top of a screen's content.
 * It scrolls with the content so it never sits under the native tab bar.
 */
export function SignInBanner({ message = 'Sign in to use this feature', onSignIn, style }: SignInBannerProps) {
  const colors = useColors();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale >= 1.5;
  return (
    <View
      style={[styles.container, { backgroundColor: colors.card }, style]}
      accessibilityRole="summary"
    >
      <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
      <View style={[styles.actions, usesLargeTextLayout && styles.actionsLargeText]}>
        <TouchableOpacity
          style={[styles.signInButton, { backgroundColor: colors.tint }]}
          onPress={onSignIn ?? (() => router.push('/(auth)/sign-in'))}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text style={[styles.signInButtonText, { color: colors.onTint }]}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.createAccountButton}
          onPress={() => router.push('/(auth)/sign-up')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Create account"
        >
          <Text style={[styles.createAccountText, { color: colors.actionText }]}>Create a free account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 12,
    marginBottom: spacing.lg,
  },
  message: {
    ...typography.headline,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.sm,
  },
  actionsLargeText: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  signInButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInButtonText: {
    ...typography.subhead,
    fontWeight: '600',
  },
  createAccountButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  createAccountText: {
    ...typography.subhead,
  },
});
