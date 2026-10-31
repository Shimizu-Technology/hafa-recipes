import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';

import { BrandMark } from '@/components/BrandMark';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import { hasProfilePhoto, resolveProfileInitial } from '@/lib/settingsProfile';

/** Render the compact Håfa Recipes identity in the Discover tab header. */
export function TabHeaderBrand() {
  const colors = useColors();

  return (
    <RNView style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Håfa Recipes">
      <BrandMark size={30} variant="icon" />
      <Text maxFontSizeMultiplier={1.3} style={[styles.brandName, { color: colors.text }]}>Håfa Recipes</Text>
    </RNView>
  );
}

/** Link the current account identity to the root Settings screen. */
export function AccountHeaderButton() {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn, user } = useUser();
  const label = isSignedIn ? 'Open account and settings' : 'Open sign in and settings';
  const initial = resolveProfileInitial(user);

  return (
    <TouchableOpacity
      style={[styles.accountButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      onPress={() => router.push('/settings')}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      {isSignedIn && hasProfilePhoto(user) ? (
        <Image source={{ uri: user.imageUrl }} style={styles.accountImage} accessibilityIgnoresInvertColors />
      ) : isSignedIn && initial ? (
        <RNView style={[styles.accountInitial, { backgroundColor: colors.accentSoft }]}>
          <Text maxFontSizeMultiplier={1} style={[styles.accountInitialText, { color: colors.accent }]}>{initial}</Text>
        </RNView>
      ) : (
        <Ionicons name={isSignedIn ? 'person' : 'person-outline'} size={19} color={colors.actionText} />
      )}
    </TouchableOpacity>
  );
}

/** Emphasize recipe import as the center action in the primary tab bar. */
export function ImportTabIcon({ focused }: { focused: boolean }) {
  const colors = useColors();

  return (
    <RNView style={[styles.importIcon, { backgroundColor: colors.tint, opacity: focused ? 1 : 0.9 }]}>
      <Ionicons name={focused ? 'add' : 'add-outline'} size={24} color={colors.onTint} />
    </RNView>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandName: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.lg,
    letterSpacing: -0.3,
  },
  accountButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accountImage: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
  },
  accountInitial: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  accountInitialText: {
    fontFamily: fontFamily.semibold, fontWeight: '600',
    fontSize: fontSize.lg,
  },
  // Filled because Import is the primary capture action, but it sits inside the
  // bar like the other icons: no ring, no shadow, no raised offset. The 28pt
  // icon slot is centered, so the negative top margin keeps the bottom edge on
  // the shared icon baseline instead of pushing into the label.
  importIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    marginTop: -6,
  },
});
