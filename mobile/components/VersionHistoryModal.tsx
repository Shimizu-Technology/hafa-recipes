import React, { useState } from 'react';
import {
  Modal,
  View as RNView,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, useColors } from './Themed';
import { useRecipeVersions, useRestoreRecipeVersion } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface VersionHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  recipeId: string;
  currentTitle?: string;
}

export default function VersionHistoryModal({
  visible,
  onClose,
  recipeId,
  currentTitle,
}: VersionHistoryModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: versions, isLoading, error } = useRecipeVersions(recipeId, visible);
  const restoreMutation = useRestoreRecipeVersion();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const handleRestore = (version: { id: string; version_number: number; title: string | null }) => {
    Alert.alert(
      'Restore Version',
      `Restore to version ${version.version_number}?\n\nThis will save your current recipe as a new version before restoring.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoringId(version.id);
            try {
              await restoreMutation.mutateAsync({ recipeId, versionId: version.id });
              Alert.alert('Restored!', `Recipe restored to version ${version.version_number}`);
              onClose();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to restore version');
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown date';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getChangeTypeIcon = (changeType: string) => {
    switch (changeType) {
      case 'initial':
        return 'star';
      case 'edit':
        return 'pencil';
      case 're-extract':
        return 'sparkles';
      default:
        return 'document';
    }
  };

  const getChangeTypeLabel = (changeType: string) => {
    switch (changeType) {
      case 'initial':
        return 'Original';
      case 'edit':
        return 'Edited';
      case 're-extract':
        return 'Re-extracted';
      default:
        return changeType;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <RNView style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Version History</Text>
            {currentTitle && (
              <Text style={[styles.headerSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                {currentTitle}
              </Text>
            )}
          </RNView>
          <RNView style={styles.headerRight} />
        </RNView>

        {/* Content */}
        {isLoading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Loading versions...
            </Text>
          </RNView>
        ) : error ? (
          <RNView style={styles.emptyContainer}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Failed to load version history
            </Text>
          </RNView>
        ) : !versions || versions.length === 0 ? (
          <RNView style={styles.emptyContainer}>
            <Ionicons name="time-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Version History</Text>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Versions are created when you edit or re-extract recipes
            </Text>
          </RNView>
        ) : (
          <ScrollView 
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
          >
            {/* Current Version Notice */}
            <RNView style={[styles.currentNotice, { backgroundColor: colors.tint + '15' }]}>
              <Ionicons name="checkmark-circle" size={20} color={colors.tint} />
              <Text style={[styles.currentNoticeText, { color: colors.tint }]}>
                You are viewing the current version
              </Text>
            </RNView>

            {/* Version List */}
            {versions.map((version, index) => (
              <RNView
                key={version.id}
                style={[
                  styles.versionItem,
                  { 
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.border,
                  },
                ]}
              >
                <RNView style={styles.versionHeader}>
                  <RNView style={[styles.versionBadge, { backgroundColor: colors.tint + '20' }]}>
                    <Ionicons 
                      name={getChangeTypeIcon(version.change_type) as any} 
                      size={14} 
                      color={colors.tint} 
                    />
                    <Text style={[styles.versionBadgeText, { color: colors.tint }]}>
                      {getChangeTypeLabel(version.change_type)}
                    </Text>
                  </RNView>
                  <Text style={[styles.versionNumber, { color: colors.textMuted }]}>
                    v{version.version_number}
                  </Text>
                </RNView>

                <Text style={[styles.versionTitle, { color: colors.text }]} numberOfLines={2}>
                  {version.title || 'Untitled'}
                </Text>

                {version.change_summary && (
                  <RNView style={styles.versionSummaryContainer}>
                    {version.change_summary.split('\n').map((line, idx) => (
                      <Text key={idx} style={[styles.versionSummary, { color: colors.textMuted }]}>
                        {line}
                      </Text>
                    ))}
                  </RNView>
                )}

                <RNView style={styles.versionFooter}>
                  <Text style={[styles.versionDate, { color: colors.textMuted }]}>
                    {formatDate(version.created_at)}
                  </Text>
                  
                  <TouchableOpacity
                    style={[styles.restoreButton, { borderColor: colors.tint }]}
                    onPress={() => handleRestore(version)}
                    disabled={restoringId === version.id}
                  >
                    {restoringId === version.id ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : (
                      <>
                        <Ionicons name="refresh" size={16} color={colors.tint} />
                        <Text style={[styles.restoreButtonText, { color: colors.tint }]}>
                          Restore
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </RNView>
              </RNView>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: spacing.xs,
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  headerRight: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  emptyText: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  currentNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  currentNoticeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  versionItem: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  versionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  versionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  versionBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  versionNumber: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  versionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  versionSummaryContainer: {
    marginBottom: spacing.sm,
  },
  versionSummary: {
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  versionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  versionDate: {
    fontSize: fontSize.xs,
  },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  restoreButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});

