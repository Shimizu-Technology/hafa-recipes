import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import type { Collection } from '@/types/recipe';

type RecipeCollectionsCardProps = {
  collections: readonly Collection[];
  isLoading: boolean;
  onOpenCollection: (collectionId: string) => void;
  onManageCollections: () => void;
};

/** Shows the reverse links from a recipe to the user's collections. */
export function RecipeCollectionsCard({
  collections,
  isLoading,
  onOpenCollection,
  onManageCollections,
}: RecipeCollectionsCardProps) {
  const colors = useColors();

  return (
    <RNView style={[
      styles.container,
      { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
    ]}>
      <RNView style={styles.header}>
        <RNView style={styles.titleRow}>
          <Ionicons name="folder-outline" size={19} color={colors.tint} />
          <Text style={[styles.title, { color: colors.text }]}>Collections</Text>
        </RNView>
        <TouchableOpacity
          onPress={onManageCollections}
          style={[styles.manageButton, { backgroundColor: colors.tint + '15' }]}
          accessibilityRole="button"
          accessibilityLabel={collections.length > 0
            ? 'Manage recipe collections'
            : 'Add recipe to a collection'}
        >
          <Ionicons name="add" size={16} color={colors.tint} />
          <Text style={[styles.manageText, { color: colors.tint }]}>
            {collections.length > 0 ? 'Manage' : 'Add'}
          </Text>
        </TouchableOpacity>
      </RNView>

      {isLoading ? (
        <RNView style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text style={[styles.supportingText, { color: colors.textMuted }]}>
            Loading collections...
          </Text>
        </RNView>
      ) : collections.length > 0 ? (
        <RNView style={styles.collectionLinks}>
          {collections.map((collection) => (
            <TouchableOpacity
              key={collection.id}
              style={[styles.collectionLink, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => onOpenCollection(collection.id)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${collection.name} collection`}
            >
              <Text style={styles.collectionEmoji}>{collection.emoji || '📁'}</Text>
              <Text style={[styles.collectionName, { color: colors.text }]} numberOfLines={1}>
                {collection.name}
              </Text>
              <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </RNView>
      ) : (
        <Text style={[styles.supportingText, { color: colors.textMuted }]}>
          Keep related recipes together for quick access.
        </Text>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  manageText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  supportingText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  collectionLinks: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  collectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  collectionEmoji: {
    fontSize: fontSize.md,
  },
  collectionName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
