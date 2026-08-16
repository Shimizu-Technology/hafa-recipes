/**
 * Grocery List Join Screen
 * 
 * Handles deep links for joining a shared grocery list.
 * Shows preview of the list and confirmation before joining.
 */

import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View as RNView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';

import { View, Text, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { useInvitePreview, useJoinGroceryList } from '@/hooks/useGrocery';

export default function JoinGroceryListScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();

  const { data: preview, isLoading, isError } = useInvitePreview(code || '', !!code && !!isSignedIn);
  const joinMutation = useJoinGroceryList();

  const handleJoin = async () => {
    if (!code) return;
    
    try {
      haptics.success();
      await joinMutation.mutateAsync(code);
      router.replace('/(tabs)/grocery');
    } catch (error) {
      console.error('Error joining list:', error);
      haptics.warning();
    }
  };

  const handleCancel = () => {
    haptics.light();
    router.back();
  };

  // Not signed in
  if (!isSignedIn) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <RNView style={styles.content}>
          <RNView style={[styles.iconCircle, { backgroundColor: colors.warning + '20' }]}>
            <Ionicons name="person-outline" size={48} color={colors.warning} />
          </RNView>
          <Text style={[styles.title, { color: colors.text }]}>Sign In Required</Text>
          <Text style={[styles.description, { color: colors.textMuted }]}>
            You need to sign in before you can join a shared grocery list.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={() => router.push('/(auth)/sign-in')}
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            onPress={handleCancel}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textMuted }]}>Cancel</Text>
          </TouchableOpacity>
        </RNView>
      </View>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <RNView style={styles.content}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading invite...
          </Text>
        </RNView>
      </View>
    );
  }

  // Invalid invite
  if (isError || !preview?.is_valid) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <RNView style={styles.content}>
          <RNView style={[styles.iconCircle, { backgroundColor: colors.error + '20' }]}>
            <Ionicons name="close-circle-outline" size={48} color={colors.error} />
          </RNView>
          <Text style={[styles.title, { color: colors.text }]}>Invalid Invite</Text>
          <Text style={[styles.description, { color: colors.textMuted }]}>
            This invite link is invalid or has expired. Ask for a new invite link.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={() => router.replace('/(tabs)/grocery')}
          >
            <Text style={styles.primaryButtonText}>Go to Grocery List</Text>
          </TouchableOpacity>
        </RNView>
      </View>
    );
  }

  // Already a member
  if (preview.already_member) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <RNView style={styles.content}>
          <RNView style={[styles.iconCircle, { backgroundColor: colors.success + '20' }]}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
          </RNView>
          <Text style={[styles.title, { color: colors.text }]}>Already a Member!</Text>
          <Text style={[styles.description, { color: colors.textMuted }]}>
            You're already a member of this grocery list.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={() => router.replace('/(tabs)/grocery')}
          >
            <Text style={styles.primaryButtonText}>Go to Grocery List</Text>
          </TouchableOpacity>
        </RNView>
      </View>
    );
  }

  // Show invite preview
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <RNView style={styles.content}>
        <RNView style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
          <Ionicons name="cart-outline" size={48} color={colors.tint} />
        </RNView>
        
        <Text style={[styles.title, { color: colors.text }]}>
          You're invited!
        </Text>
        
        <Text style={[styles.description, { color: colors.textMuted }]}>
          {preview.created_by_name || 'Someone'} invited you to shop together.
        </Text>

        {/* Members preview */}
        <RNView style={[styles.membersCard, { backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[styles.membersTitle, { color: colors.text }]}>
            Current members ({preview.member_count})
          </Text>
          {preview.members.map((name, index) => (
            <RNView key={index} style={styles.memberRow}>
              <RNView style={[styles.memberAvatar, { backgroundColor: colors.tint + '20' }]}>
                <Ionicons name="person" size={16} color={colors.tint} />
              </RNView>
              <Text style={[styles.memberName, { color: colors.text }]}>
                {name}
              </Text>
            </RNView>
          ))}
        </RNView>

        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Your personal grocery items will be saved and can be restored if you leave later.
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.tint }]}
          onPress={handleJoin}
          disabled={joinMutation.isPending}
        >
          {joinMutation.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="people" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.primaryButtonText}>Join List</Text>
            </>
          )}
        </TouchableOpacity>

        {joinMutation.isError && (
          <Text style={[styles.errorText, { color: colors.error }]}>
            Failed to join. Please try again.
          </Text>
        )}

        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          onPress={handleCancel}
          disabled={joinMutation.isPending}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textMuted }]}>
            Not Now
          </Text>
        </TouchableOpacity>
      </RNView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  loadingText: {
    fontSize: fontSize.md,
    marginTop: spacing.lg,
  },
  membersCard: {
    width: '100%',
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  membersTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  memberName: {
    fontSize: fontSize.md,
  },
  hint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  errorText: {
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
});
