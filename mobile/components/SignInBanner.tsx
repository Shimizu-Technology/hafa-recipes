import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface SignInBannerProps {
  message?: string;
}

export function SignInBanner({ message = 'Sign in to use this feature' }: SignInBannerProps) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View 
      style={[
        styles.container, 
        { 
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.md) + 60, // Account for tab bar
        }
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.message, { color: colors.text }]}>
          {message}
        </Text>
        <TouchableOpacity 
          style={[styles.signInButton, { backgroundColor: colors.tint }]}
          onPress={() => router.push('/(auth)/sign-in')}
          activeOpacity={0.8}
        >
          <Ionicons name="log-in-outline" size={18} color="#fff" />
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity 
        onPress={() => router.push('/(auth)/sign-up')}
        activeOpacity={0.7}
      >
        <Text style={[styles.createAccountText, { color: colors.tint }]}>
          New here? <Text style={styles.createAccountBold}>Create an account</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
    marginRight: spacing.md,
  },
  signInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  createAccountText: {
    fontSize: fontSize.sm,
  },
  createAccountBold: {
    fontWeight: fontWeight.semibold,
  },
});
