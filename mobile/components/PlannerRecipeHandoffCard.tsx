import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';

type PlannerRecipeHandoffCardProps = {
  title?: string;
  thumbnailUrl?: string | null;
  isLoading: boolean;
  hasError: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onDismiss: () => void;
};

/** Shows the authoritative recipe currently being placed into the meal plan. */
export function PlannerRecipeHandoffCard({
  title,
  thumbnailUrl,
  isLoading,
  hasError,
  isRetrying,
  onRetry,
  onDismiss,
}: PlannerRecipeHandoffCardProps) {
  const colors = useColors();

  return (
    <RNView
      style={[
        styles.container,
        { backgroundColor: colors.backgroundSecondary, borderColor: colors.tint },
      ]}
    >
      {isLoading ? (
        <RNView style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>
            Loading recipe to plan...
          </Text>
        </RNView>
      ) : hasError || !title ? (
        <RNView style={styles.errorContent}>
          <RNView style={styles.statusRow}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.tint} />
            <Text style={[styles.statusText, { color: colors.text }]}>
              We couldn't load this recipe.
            </Text>
          </RNView>
          <RNView style={styles.actions}>
            <TouchableOpacity
              onPress={onRetry}
              disabled={isRetrying}
              style={[styles.actionButton, { borderColor: colors.tint }]}
              accessibilityRole="button"
              accessibilityLabel={isRetrying ? 'Retrying recipe load' : 'Retry recipe load'}
              accessibilityState={{ busy: isRetrying, disabled: isRetrying }}
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Ionicons name="refresh" size={16} color={colors.tint} />
              )}
              <Text style={[styles.actionText, { color: colors.tint }]}>
                {isRetrying ? 'Retrying...' : 'Retry'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onDismiss}
              style={styles.dismissTextButton}
              accessibilityRole="button"
              accessibilityLabel="Choose a different recipe"
            >
              <Text style={[styles.dismissText, { color: colors.textMuted }]}>Choose another</Text>
            </TouchableOpacity>
          </RNView>
        </RNView>
      ) : (
        <RNView style={styles.recipeRow}>
          {thumbnailUrl ? (
            <Image
              source={{ uri: thumbnailUrl }}
              style={styles.thumbnail}
              accessibilityLabel={`${title} thumbnail`}
            />
          ) : (
            <RNView
              style={[styles.thumbnail, styles.placeholder, { backgroundColor: colors.tint + '15' }]}
              accessible
              accessibilityRole="image"
              accessibilityLabel="Recipe thumbnail unavailable"
            >
              <Ionicons name="restaurant-outline" size={22} color={colors.tint} />
            </RNView>
          )}
          <RNView style={styles.recipeCopy}>
            <Text style={[styles.eyebrow, { color: colors.tint }]}>Planning this recipe</Text>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {title}
            </Text>
            <Text style={[styles.instructions, { color: colors.textMuted }]}>
              Choose a day, then tap a meal slot.
            </Text>
          </RNView>
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Stop planning this recipe"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </RNView>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  statusText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  errorContent: {
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  actionButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  actionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  dismissTextButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  recipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: 3,
  },
  instructions: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
