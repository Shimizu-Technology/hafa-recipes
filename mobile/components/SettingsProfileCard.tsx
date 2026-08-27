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
  isSignedIn: boolean;
  profileName: string;
  user: SettingsProfileCardUser | null | undefined;
  onPress: () => void;
}

/** Render the Settings account summary with the user's primary identity. */
export function SettingsProfileCard({
  isSignedIn,
  profileName,
  user,
  onPress,
}: SettingsProfileCardProps) {
  const colors = useColors();
  const emailAddress = resolveSettingsProfileEmail(user);

  return (
    <TouchableOpacity
      accessible
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isSignedIn ? `Account profile for ${profileName}` : 'Guest account. Sign in'}
      accessibilityHint={isSignedIn ? 'Opens profile editing' : 'Opens sign in'}
    >
      <Card>
        <RNView style={styles.userCard}>
          {isSignedIn && user?.imageUrl ? (
            <Image source={{ uri: user.imageUrl }} style={styles.userAvatar} />
          ) : (
            <RNView style={[styles.userAvatarPlaceholder, { backgroundColor: colors.tint + '20' }]}>
              <Ionicons name="person" size={32} color={colors.tint} />
            </RNView>
          )}
          <RNView style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{profileName}</Text>
            <Text style={[styles.userEmail, { color: isSignedIn ? colors.textMuted : colors.tint }]}>
              {isSignedIn ? emailAddress : 'Tap to sign in →'}
            </Text>
            {isSignedIn && !user?.firstName && (
              <Text style={[styles.userHint, { color: colors.tint }]}>
                Tap to add your name for recipe attribution
              </Text>
            )}
          </RNView>
          <Ionicons name="chevron-forward" size={20} color={isSignedIn ? colors.textMuted : colors.tint} />
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
