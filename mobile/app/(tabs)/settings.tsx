import { useState } from 'react';
import { StyleSheet, TouchableOpacity, Linking, Alert, View as RNView, ScrollView, Image, Share, ActivityIndicator } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser, useClerk, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Card, SectionHeader, Divider, useColors } from '@/components/Themed';
import { useRecipeCount } from '@/hooks/useRecipes';
import { API_BASE_URL, api } from '@/lib/api';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

// TODO: Update with real App Store ID once approved
const APP_STORE_URL = 'https://apps.apple.com/app/recipe-extractor/id123456789';

interface MenuItemProps {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}

function MenuItem({ icon, label, value, onPress, colors }: MenuItemProps) {
  const content = (
    <RNView 
      style={[
        styles.menuItem, 
        { backgroundColor: colors.backgroundSecondary }
      ]}
    >
      <RNView style={styles.menuItemLeft}>
        <Text style={styles.menuIcon}>{icon}</Text>
        <Text style={[styles.menuLabel, { color: colors.text }]}>{label}</Text>
      </RNView>
      {value ? (
        <Text style={[styles.menuValue, { color: colors.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
      ) : onPress ? (
        <Text style={[styles.menuArrow, { color: colors.textMuted }]}>›</Text>
      ) : null}
    </RNView>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const { data: countData } = useRecipeCount();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [isDeleting, setIsDeleting] = useState(false);
  
  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will refresh all recipe data from the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            queryClient.clear();
            Alert.alert('Done', 'Cache cleared successfully');
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            // Cancel all pending queries first
            queryClient.cancelQueries();
            queryClient.clear();
            // Clear the API token getter to prevent further requests
            api.setTokenGetter(null);
            await signOut();
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to permanently delete your account? This will delete all your recipes, grocery list items, and saved data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => {
            // Second confirmation for extra safety
            Alert.alert(
              'Final Confirmation',
              'This is permanent. All your data will be deleted forever.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Forever',
                  style: 'destructive',
                  onPress: async () => {
                    setIsDeleting(true);
                    try {
                      // Delete account on server
                      await api.deleteAccount();
                      
                      // Cancel all pending queries to prevent refetch errors
                      queryClient.cancelQueries();
                      queryClient.clear();
                      
                      // Clear the API token getter to prevent further requests
                      api.setTokenGetter(null);
                      
                      // Sign out
                      await signOut();
                    } catch (error: any) {
                      console.error('Delete account error:', error);
                      // Only show error if it's not an auth error (account was already deleted)
                      if (error?.response?.status !== 401) {
                        Alert.alert('Error', 'Failed to delete account. Please try again.');
                      }
                    } finally {
                      setIsDeleting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleOpenAPI = () => {
    Linking.openURL(`${API_BASE_URL}/docs`);
  };

  const handleShareApp = async () => {
    try {
      await Share.share({
        message: `🍳 Check out Recipe Extractor!\n\nTransform cooking videos from TikTok, YouTube, and Instagram into detailed recipes using AI.\n\nDownload it here: ${APP_STORE_URL}`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 80) + spacing.xl }]}
      >
        {/* User Profile Card */}
        <RNView style={styles.section}>
          <SectionHeader title="Account" />
          <TouchableOpacity 
            activeOpacity={isSignedIn ? 1 : 0.7}
            onPress={isSignedIn ? undefined : () => router.push('/(auth)/sign-in')}
            disabled={isSignedIn}
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
                  <Text style={[styles.userName, { color: colors.text }]}>
                    {isSignedIn 
                      ? (user?.firstName || user?.emailAddresses[0]?.emailAddress?.split('@')[0] || 'User')
                      : 'Guest User'}
                  </Text>
                  <Text style={[styles.userEmail, { color: isSignedIn ? colors.textMuted : colors.tint }]}>
                    {isSignedIn 
                      ? user?.emailAddresses[0]?.emailAddress
                      : 'Tap to sign in →'}
                  </Text>
                </RNView>
                {!isSignedIn && (
                  <Ionicons name="chevron-forward" size={20} color={colors.tint} />
                )}
              </RNView>
            </Card>
          </TouchableOpacity>
        </RNView>

        {/* Stats Card - only for signed in users */}
        {isSignedIn && (
          <RNView style={styles.section}>
            <SectionHeader title="Statistics" />
            <RNView style={[styles.statCard, { backgroundColor: colors.tint }]}>
              <Text style={styles.statValue}>{countData?.count ?? '...'}</Text>
              <Text style={styles.statLabel}>Recipes Saved</Text>
            </RNView>
          </RNView>
        )}

        {/* Data Section */}
        <RNView style={styles.section}>
          <SectionHeader title="Data" />
          <MenuItem 
            icon="🗑️" 
            label="Clear Cache" 
            onPress={handleClearCache}
            colors={colors}
          />
        </RNView>

        {/* Developer Section */}
        <RNView style={styles.section}>
          <SectionHeader title="Developer" />
          <RNView style={styles.menuGroup}>
            <MenuItem 
              icon="📚" 
              label="API Documentation" 
              onPress={handleOpenAPI}
              colors={colors}
            />
            <RNView style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            <MenuItem 
              icon="🔗" 
              label="API URL" 
              value={API_BASE_URL.replace('http://', '').replace('https://', '')}
              colors={colors}
            />
          </RNView>
        </RNView>

        {/* About Section */}
        <RNView style={styles.section}>
          <SectionHeader title="About" />
          <Card>
            <RNView style={styles.aboutHeader}>
              <Text style={styles.aboutEmoji}>🍳</Text>
              <RNView>
                <Text style={[styles.aboutTitle, { color: colors.text }]}>
                  Recipe Extractor
                </Text>
                <Text style={[styles.aboutVersion, { color: colors.textMuted }]}>
                  Version 1.0.1
                </Text>
              </RNView>
            </RNView>
            
            <Divider />
            
            <Text style={[styles.aboutDescription, { color: colors.textSecondary }]}>
              Transform cooking videos from TikTok, YouTube, and Instagram into 
              detailed, structured recipes using AI.
            </Text>
            
            <Divider />
            
            <Text style={[styles.techLabel, { color: colors.textMuted }]}>
              Powered by
            </Text>
            <RNView style={styles.techList}>
              <Text style={[styles.techItem, { color: colors.textSecondary }]}>
                • OpenAI Whisper
              </Text>
              <Text style={[styles.techItem, { color: colors.textSecondary }]}>
                • GPT-4o-mini
              </Text>
              <Text style={[styles.techItem, { color: colors.textSecondary }]}>
                • FastAPI + React Native
              </Text>
            </RNView>
          </Card>
        </RNView>

        {/* Share App */}
        <RNView style={styles.section}>
          <TouchableOpacity
            style={[styles.shareAppButton, { backgroundColor: colors.tint }]}
            onPress={handleShareApp}
            activeOpacity={0.7}
          >
            <Ionicons name="heart-outline" size={20} color="#FFFFFF" />
            <Text style={styles.shareAppText}>Share App with Friends</Text>
          </TouchableOpacity>
        </RNView>

        {/* Account Actions - only for signed in users */}
        {isSignedIn && (
          <RNView style={styles.section}>
            <SectionHeader title="Account Actions" />
            <RNView style={[styles.accountActionsCard, { backgroundColor: colors.backgroundSecondary }]}>
              <TouchableOpacity
                style={styles.accountActionRow}
                onPress={handleSignOut}
                activeOpacity={0.7}
              >
                <RNView style={styles.accountActionLeft}>
                  <Ionicons name="log-out-outline" size={20} color={colors.text} />
                  <Text style={[styles.accountActionText, { color: colors.text }]}>Sign Out</Text>
                </RNView>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
              
              <RNView style={[styles.accountDivider, { backgroundColor: colors.border }]} />
              
              <TouchableOpacity
                style={styles.accountActionRow}
                onPress={handleDeleteAccount}
                activeOpacity={0.7}
                disabled={isDeleting}
              >
                <RNView style={styles.accountActionLeft}>
                  {isDeleting ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                  )}
                  <Text style={[styles.accountActionText, { color: colors.textMuted }]}>
                    {isDeleting ? 'Deleting...' : 'Delete Account'}
                  </Text>
                </RNView>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </RNView>
          </RNView>
        )}
      </ScrollView>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  statCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 56,
    fontWeight: fontWeight.bold,
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: fontSize.md,
    color: '#FFFFFF',
    opacity: 0.9,
    marginTop: spacing.xs,
  },
  menuGroup: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuIcon: {
    fontSize: 18,
  },
  menuLabel: {
    fontSize: fontSize.md,
  },
  menuValue: {
    fontSize: fontSize.sm,
    maxWidth: 150,
  },
  menuArrow: {
    fontSize: 24,
    fontWeight: fontWeight.medium,
  },
  menuDivider: {
    height: 1,
    marginHorizontal: spacing.md,
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  aboutEmoji: {
    fontSize: 40,
  },
  aboutTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  aboutVersion: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  aboutDescription: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  techLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  techList: {
    gap: spacing.xs,
  },
  techItem: {
    fontSize: fontSize.sm,
  },
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
  shareAppButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  shareAppText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: '#FFFFFF',
  },
  accountActionsCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  accountActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  accountActionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  accountActionText: {
    fontSize: fontSize.md,
  },
  accountDivider: {
    height: 1,
    marginLeft: spacing.md + 20 + spacing.md, // Icon width + gaps
  },
});
