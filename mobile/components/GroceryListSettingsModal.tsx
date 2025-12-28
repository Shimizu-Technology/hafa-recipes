/**
 * Grocery List Settings Modal
 * 
 * Allows users to share their grocery list with others.
 */

import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View as RNView,
  Share,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';

import { View, Text, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import {
  useGroceryListInfo,
  useCreateGroceryInvite,
  useLeaveGroceryList,
  useRemoveGroceryMember,
  useJoinGroceryList,
} from '@/hooks/useGrocery';

interface GroceryListSettingsModalProps {
  isVisible: boolean;
  onClose: () => void;
}

export default function GroceryListSettingsModal({
  isVisible,
  onClose,
}: GroceryListSettingsModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const { data: listInfo, isLoading: isLoadingInfo } = useGroceryListInfo();
  const createInviteMutation = useCreateGroceryInvite();
  const leaveListMutation = useLeaveGroceryList();
  const removeMemberMutation = useRemoveGroceryMember();
  const joinMutation = useJoinGroceryList();

  const handleShareList = async () => {
    try {
      haptics.light();
      const invite = await createInviteMutation.mutateAsync();
      
      await Share.share({
        message: `Join my grocery list on Håfa Recipes!\n\nOpen this link to shop together:\n${invite.deep_link}\n\nOr enter this code in the app: ${invite.invite_code}`,
      });
    } catch (error) {
      console.error('Error creating invite:', error);
      Alert.alert('Error', 'Failed to create invite. Please try again.');
    }
  };

  const handleCopyCode = async () => {
    try {
      haptics.light();
      const invite = await createInviteMutation.mutateAsync();
      await Clipboard.setStringAsync(invite.invite_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (error) {
      console.error('Error copying code:', error);
      Alert.alert('Error', 'Failed to copy code. Please try again.');
    }
  };

  const handleLeaveList = () => {
    Alert.alert(
      'Leave Shared List?',
      'Your personal grocery items will be restored. You can always rejoin with a new invite.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              haptics.warning();
              await leaveListMutation.mutateAsync();
              onClose();
              Alert.alert('Success', 'You have left the shared list. Your personal items have been restored.');
            } catch (error) {
              console.error('Error leaving list:', error);
              Alert.alert('Error', 'Failed to leave the list. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleRemoveMember = (userId: string, displayName: string | null) => {
    Alert.alert(
      'Remove Member?',
      `Remove ${displayName || 'this person'} from the shared list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              haptics.warning();
              await removeMemberMutation.mutateAsync(userId);
            } catch (error) {
              console.error('Error removing member:', error);
              Alert.alert('Error', 'Failed to remove member. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleJoinWithCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      Alert.alert('Enter Code', 'Please enter an invite code to join a list.');
      return;
    }

    try {
      haptics.success();
      await joinMutation.mutateAsync(code);
      setJoinCode('');
      onClose();
      Alert.alert('Success!', 'You have joined the shared grocery list.');
    } catch (error: any) {
      console.error('Error joining list:', error);
      const message = error?.response?.data?.detail || 'Failed to join. Please check the code and try again.';
      Alert.alert('Error', message);
      haptics.warning();
    }
  };

  const isShared = listInfo?.is_shared ?? false;
  const members = listInfo?.members ?? [];

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <RNView style={styles.overlay}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={[
                styles.container,
                {
                  backgroundColor: colors.background,
                  paddingBottom: insets.bottom + spacing.md,
                },
              ]}
            >
              {/* Header */}
              <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  List Settings
                </Text>
                <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </RNView>

              <ScrollView 
                style={styles.content} 
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
            {isLoadingInfo ? (
              <ActivityIndicator size="large" color={colors.tint} style={styles.loader} />
            ) : (
              <>
                {/* Share Section */}
                <RNView style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Share List
                  </Text>
                  <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>
                    Invite someone to shop together. They can add items and check them off too!
                  </Text>

                  <RNView style={styles.buttonRow}>
                    <TouchableOpacity
                      style={[styles.shareButton, { backgroundColor: colors.tint }]}
                      onPress={handleShareList}
                      disabled={createInviteMutation.isPending}
                    >
                      {createInviteMutation.isPending ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="share-outline" size={20} color="#FFFFFF" />
                          <Text style={styles.shareButtonText}>Share Invite</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.copyButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                      onPress={handleCopyCode}
                      disabled={createInviteMutation.isPending}
                    >
                      <Ionicons 
                        name={copiedCode ? 'checkmark' : 'copy-outline'} 
                        size={20} 
                        color={copiedCode ? colors.success : colors.tint} 
                      />
                      <Text style={[styles.copyButtonText, { color: copiedCode ? colors.success : colors.tint }]}>
                        {copiedCode ? 'Copied!' : 'Copy Code'}
                      </Text>
                    </TouchableOpacity>
                  </RNView>
                </RNView>

                {/* Join a List Section */}
                <RNView style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Join a List
                  </Text>
                  <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>
                    Have an invite code? Enter it below to join someone's grocery list.
                  </Text>

                  <RNView style={styles.joinRow}>
                    <TextInput
                      style={[
                        styles.joinInput,
                        {
                          backgroundColor: colors.backgroundSecondary,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                      ]}
                      placeholder="Enter code (e.g., ABC12345)"
                      placeholderTextColor={colors.textMuted}
                      value={joinCode}
                      onChangeText={setJoinCode}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={10}
                    />
                    <TouchableOpacity
                      style={[
                        styles.joinButton,
                        { 
                          backgroundColor: joinCode.trim() ? colors.tint : colors.border,
                        },
                      ]}
                      onPress={handleJoinWithCode}
                      disabled={!joinCode.trim() || joinMutation.isPending}
                    >
                      {joinMutation.isPending ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons name="enter-outline" size={20} color="#FFFFFF" />
                      )}
                    </TouchableOpacity>
                  </RNView>
                </RNView>

                {/* Members Section */}
                <RNView style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {isShared ? 'Members' : 'Just You'}
                  </Text>
                  
                  {members.map((member) => (
                    <RNView
                      key={member.user_id}
                      style={[styles.memberRow, { backgroundColor: colors.backgroundSecondary }]}
                    >
                      <RNView style={[styles.memberAvatar, { backgroundColor: colors.tint + '20' }]}>
                        <Ionicons name="person" size={20} color={colors.tint} />
                      </RNView>
                      <RNView style={styles.memberInfo}>
                        <Text style={[styles.memberName, { color: colors.text }]}>
                          {member.display_name || 'A chef'}
                          {member.is_you && ' (you)'}
                        </Text>
                        <Text style={[styles.memberJoined, { color: colors.textMuted }]}>
                          Joined {new Date(member.joined_at).toLocaleDateString()}
                        </Text>
                      </RNView>
                      {!member.is_you && (
                        <TouchableOpacity
                          onPress={() => handleRemoveMember(member.user_id, member.display_name)}
                          style={styles.removeButton}
                          disabled={removeMemberMutation.isPending}
                        >
                          <Ionicons name="close-circle" size={24} color={colors.error} />
                        </TouchableOpacity>
                      )}
                    </RNView>
                  ))}
                </RNView>

                {/* Leave Section (only if shared) */}
                {isShared && (
                  <RNView style={styles.section}>
                    <TouchableOpacity
                      style={[styles.leaveButton, { borderColor: colors.error }]}
                      onPress={handleLeaveList}
                      disabled={leaveListMutation.isPending}
                    >
                      {leaveListMutation.isPending ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : (
                        <>
                          <Ionicons name="exit-outline" size={20} color={colors.error} />
                          <Text style={[styles.leaveButtonText, { color: colors.error }]}>
                            Leave Shared List
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <Text style={[styles.leaveHint, { color: colors.textMuted }]}>
                      Your personal items will be restored when you leave.
                    </Text>
                  </RNView>
                )}
              </>
            )}
              </ScrollView>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </RNView>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  closeButton: {
    padding: spacing.xs,
  },
  content: {
    padding: spacing.lg,
  },
  loader: {
    marginTop: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  copyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  copyButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  joinRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  joinInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    letterSpacing: 1,
  },
  joinButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  memberName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  memberJoined: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  removeButton: {
    padding: spacing.xs,
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  leaveButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  leaveHint: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
