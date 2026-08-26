import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import type { IngredientMatchResult } from '@/types/recipe';

type IngredientMatchCardProps = {
  result: IngredientMatchResult;
  onOpen: () => void;
  onAddMissing?: () => void;
  isAdding?: boolean;
  isAdded?: boolean;
  isGroceryActionDisabled?: boolean;
};

export function getIngredientMatchPresentation(result: IngredientMatchResult) {
  const missingCount = result.missing_ingredients.length;
  if (missingCount === 0) {
    return {
      label: 'Ready to cook',
      detail: 'You have every listed ingredient',
      tone: 'success' as const,
    };
  }
  if (missingCount <= 2) {
    return {
      label: 'Almost there',
      detail: `${missingCount} ingredient${missingCount === 1 ? '' : 's'} missing`,
      tone: 'warning' as const,
    };
  }
  return {
    label: `${result.match_count} of ${result.total_ingredients} matched`,
    detail: `${missingCount} ingredients missing`,
    tone: 'default' as const,
  };
}

/** A decision-focused ingredient result with direct recipe and grocery actions. */
export function IngredientMatchCard({
  result,
  onOpen,
  onAddMissing,
  isAdding = false,
  isAdded = false,
  isGroceryActionDisabled = false,
}: IngredientMatchCardProps) {
  const colors = useColors();
  const [imageFailed, setImageFailed] = useState(false);
  const { recipe } = result;
  const presentation = getIngredientMatchPresentation(result);
  const missingCount = result.missing_ingredients.length;
  const progress = Math.max(0, Math.min(100, result.match_percentage));
  const toneColor = presentation.tone === 'success'
    ? colors.success
    : presentation.tone === 'warning'
      ? colors.warning
      : colors.tint;
  const showPlaceholder = !recipe.thumbnail_url || imageFailed;

  return (
    <RNView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <TouchableOpacity
        style={styles.recipeButton}
        onPress={onOpen}
        activeOpacity={0.78}
        accessibilityRole="link"
        accessibilityLabel={`Open ${recipe.title} recipe. ${presentation.label}. ${presentation.detail}`}
      >
        {showPlaceholder ? (
          <RNView style={[styles.thumbnail, styles.thumbnailPlaceholder, { backgroundColor: colors.tint + '14' }]}>
            <Ionicons name="restaurant-outline" size={30} color={colors.tint} />
          </RNView>
        ) : (
          <Image
            source={{ uri: recipe.thumbnail_url! }}
            style={styles.thumbnail}
            onError={() => setImageFailed(true)}
            accessible
            accessibilityLabel={`${recipe.title} thumbnail`}
          />
        )}

        <RNView style={styles.content}>
          <RNView style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {recipe.title}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </RNView>

          <RNView style={styles.statusRow}>
            <RNView style={[styles.statusBadge, { backgroundColor: toneColor + '18' }]}>
              <Ionicons
                name={missingCount === 0 ? 'checkmark-circle' : 'nutrition-outline'}
                size={14}
                color={toneColor}
              />
              <Text style={[styles.statusLabel, { color: toneColor }]}>{presentation.label}</Text>
            </RNView>
            <Text style={[styles.statusDetail, { color: colors.textMuted }]}>
              {presentation.detail}
            </Text>
          </RNView>

          <RNView style={[styles.progressTrack, { backgroundColor: colors.backgroundSecondary }]}>
            <RNView
              style={[styles.progressFill, { backgroundColor: toneColor, width: `${progress}%` }]}
            />
          </RNView>
        </RNView>
      </TouchableOpacity>

      <RNView style={[styles.ingredients, { borderTopColor: colors.border }]}>
        <Text style={[styles.ingredientLine, { color: colors.textSecondary }]} numberOfLines={2}>
          <Text style={[styles.ingredientLabel, { color: colors.success }]}>Have </Text>
          {result.matched_ingredients.join(', ')}
        </Text>
        {missingCount > 0 && (
          <Text style={[styles.ingredientLine, { color: colors.textSecondary }]} numberOfLines={2}>
            <Text style={[styles.ingredientLabel, { color: colors.warning }]}>Need </Text>
            {result.missing_ingredients.join(', ')}
          </Text>
        )}
      </RNView>

      {onAddMissing && missingCount > 0 && (
        <TouchableOpacity
          style={[
            styles.groceryButton,
            {
              backgroundColor: isAdded ? colors.success + '16' : colors.tint + '14',
              borderColor: isAdded ? colors.success + '50' : colors.tint + '40',
            },
          ]}
          onPress={onAddMissing}
          disabled={isAdding || isGroceryActionDisabled || isAdded}
          accessibilityRole="button"
          accessibilityLabel={isAdded
            ? `${recipe.title} missing ingredients added to grocery list`
            : `Add ${missingCount} missing ingredient${missingCount === 1 ? '' : 's'} from ${recipe.title} to grocery list`}
          accessibilityState={{
            disabled: isAdding || isGroceryActionDisabled || isAdded,
            busy: isAdding,
          }}
        >
          {isAdding ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <Ionicons
              name={isAdded ? 'checkmark-circle' : 'cart-outline'}
              size={18}
              color={isAdded ? colors.success : colors.tint}
            />
          )}
          <Text style={[styles.groceryButtonText, { color: isAdded ? colors.success : colors.tint }]}>
            {isAdding
              ? 'Adding…'
              : isAdded
                ? 'Added to Grocery'
                : `Add ${missingCount} Missing`}
          </Text>
        </TouchableOpacity>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  recipeButton: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
  },
  thumbnail: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  title: {
    flex: 1,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  statusRow: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  statusDetail: {
    fontSize: fontSize.xs,
  },
  progressTrack: {
    height: 5,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  ingredients: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  ingredientLine: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  ingredientLabel: {
    fontWeight: fontWeight.semibold,
  },
  groceryButton: {
    minHeight: 46,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  groceryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
