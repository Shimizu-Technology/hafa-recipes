import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Image,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';

import { Card, Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, spacing } from '@/constants/Colors';
import { resolveSettingsProfileEmail } from '../lib/settingsProfile';

interface SettingsProfileCardUser {
  imageUrl?: string | null;
  firstName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: readonly { emailAddress?: string | null }[];
}

interface SettingsProfileCardProps {
  isLoaded: boolean;
  isSignedIn: boolean;
  profileName: string;
  user: SettingsProfileCardUser | null | undefined;
  onPress: () => void;
}

/** Render the Settings account summary with the user's primary identity. */
export function SettingsProfileCard({
  isLoaded,
  isSignedIn,
  profileName,
  user,
  onPress,
}: SettingsProfileCardProps) {
  const colors = useColors();
  const emailAddress = resolveSettingsProfileEmail(user);
  const accountLabel = !isLoaded
    ? 'Account loading'
    : isSignedIn
      ? `Account profile for ${profileName}`
      : 'Guest account. Sign in';

  return (
    <TouchableOpacity
      accessible
      activeOpacity={0.7}
      onPress={onPress}
      disabled={!isLoaded}
      accessibilityRole="button"
      accessibilityLabel={accountLabel}
      accessibilityHint={!isLoaded ? undefined : isSignedIn ? 'Opens profile editing' : 'Opens sign in'}
      accessibilityState={{ disabled: !isLoaded, busy: !isLoaded }}
    >
      <Card>
        <RNView style={styles.userCard}>
          {isLoaded && isSignedIn && user?.imageUrl ? (
            <Image source={{ uri: user.imageUrl }} style={styles.userAvatar} />
          ) : (
            <RNView style={[styles.userAvatarPlaceholder, { backgroundColor: colors.tint + '20' }]}>
              <Ionicons
                name={isLoaded ? 'person' : 'time-outline'}
                size={32}
                color={isLoaded ? colors.tint : colors.textMuted}
              />
            </RNView>
          )}
          <RNView style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>
              {isLoaded ? profileName : 'Loading account…'}
            </Text>
            <Text style={[styles.userEmail, { color: isLoaded && !isSignedIn ? colors.tint : colors.textMuted }]}>
              {!isLoaded ? 'Checking your session…' : isSignedIn ? emailAddress : 'Tap to sign in →'}
            </Text>
            {isLoaded && isSignedIn && !user?.firstName && (
              <Text style={[styles.userHint, { color: colors.tint }]}>
                Tap to add your name for recipe attribution
              </Text>
            )}
          </RNView>
          {isLoaded && (
            <Ionicons name="chevron-forward" size={20} color={isSignedIn ? colors.textMuted : colors.tint} />
          )}
        </RNView>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  userAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  userAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  userEmail: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  userHint: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
