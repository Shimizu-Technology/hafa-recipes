import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/components/Themed';
import { shadows, spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import {
  clearGuestPromptHeight,
  setGuestPromptHeight,
} from '../lib/guestPromptLayout';

interface SignInBannerProps {
  message?: string;
}

/** Show compact sign-in and account-creation actions above a primary tab bar. */
export function SignInBanner({ message = 'Sign in to use this feature' }: SignInBannerProps) {
  const colors = useColors();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale >= 1.5;
  const promptId = useRef(Symbol('guest-prompt')).current;

  useEffect(() => () => clearGuestPromptHeight(promptId), [promptId]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setGuestPromptHeight(promptId, event.nativeEvent.layout.height);
  };

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.container,
        usesLargeTextLayout && styles.containerLargeText,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.shadowColor,
        },
      ]}
      accessibilityRole="summary"
    >
      <View style={[styles.iconContainer, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name="bookmark-outline" size={19} color={colors.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
        <TouchableOpacity
          onPress={() => router.push('/(auth)/sign-up')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          hitSlop={6}
        >
          <Text style={[styles.createAccountText, { color: colors.textSecondary }]}>Create a free account</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[
          styles.signInButton,
          usesLargeTextLayout && styles.signInButtonLargeText,
          { backgroundColor: colors.tint },
        ]}
        onPress={() => router.push('/(auth)/sign-in')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
      >
        <Text style={styles.signInButtonText}>Sign in</Text>
        <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.sm + 2,
    ...shadows.medium,
  },
  containerLargeText: {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  message: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  signInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  signInButtonLargeText: {
    width: '100%',
    justifyContent: 'center',
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  createAccountText: {
    fontSize: fontSize.xs,
    marginTop: 2,
    textDecorationLine: 'underline',
  },
});
