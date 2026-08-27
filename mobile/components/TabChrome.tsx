import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';

import { BrandMark } from '@/components/BrandMark';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';

export function TabHeaderBrand() {
  const colors = useColors();

  return (
    <RNView style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Håfa Recipes">
      <BrandMark size={30} variant="icon" />
      <Text style={[styles.brandName, { color: colors.text }]}>Håfa Recipes</Text>
    </RNView>
  );
}

export function AccountHeaderButton() {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn, user } = useUser();
  const label = isSignedIn ? 'Open account and settings' : 'Open sign in and settings';

  return (
    <TouchableOpacity
      style={[styles.accountButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      onPress={() => router.push('/settings')}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      {isSignedIn && user?.imageUrl ? (
        <Image source={{ uri: user.imageUrl }} style={styles.accountImage} accessibilityIgnoresInvertColors />
      ) : (
        <Ionicons name={isSignedIn ? 'person' : 'person-outline'} size={19} color={colors.tint} />
      )}
    </TouchableOpacity>
  );
}

export function ImportTabIcon({ focused }: { focused: boolean }) {
  const colors = useColors();

  return (
    <RNView
      style={[
        styles.importIcon,
        {
          backgroundColor: colors.tint,
          borderColor: colors.backgroundElevated,
          opacity: focused ? 1 : 0.9,
          shadowColor: colors.shadowColor,
        },
      ]}
    >
      <Ionicons name={focused ? 'add' : 'add-outline'} size={27} color="#FFFFFF" />
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
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accountImage: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
  },
  importIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 3,
    marginTop: -11,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
  },
});
