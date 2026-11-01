import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius } from '@/constants/Colors';
import { hasProfilePhoto, resolveProfileInitial } from '@/lib/settingsProfile';

/** Link the current account identity to the root Settings screen. */
export function AccountHeaderButton() {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn, user } = useUser();
  const label = isSignedIn ? 'Open account and settings' : 'Open sign in and settings';
  const initial = resolveProfileInitial(user);

  return (
    <TouchableOpacity
      style={styles.accountButton}
      onPress={() => router.push('/settings')}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      {isSignedIn && hasProfilePhoto(user) ? (
        <Image source={{ uri: user.imageUrl }} style={styles.accountImage} accessibilityIgnoresInvertColors />
      ) : (
        // Same tonal circle as the other header buttons, so the header reads as one group.
        <RNView style={[styles.accountInitial, { backgroundColor: colors.surface2 }]}>
          {isSignedIn && initial
            ? <Text maxFontSizeMultiplier={1} style={[styles.accountInitialText, { color: colors.text }]}>{initial}</Text>
            : <Ionicons name={isSignedIn ? 'person' : 'person-outline'} size={18} color={colors.text} />}
        </RNView>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  accountButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,

    overflow: 'hidden',
  },
  accountImage: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
  },
  accountInitial: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  accountInitialText: {
    fontFamily: fontFamily.semibold, fontWeight: '600',
    fontSize: fontSize.md,
  },
});
