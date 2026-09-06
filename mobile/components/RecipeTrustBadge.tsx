import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View as RNView } from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import { getRecipeTrustPresentation } from '../lib/recipeTrust';
import type { RecipeReviewState } from '@/types/recipe';

type RecipeTrustBadgeProps = {
  reviewState?: RecipeReviewState | null;
  inverted?: boolean;
};

/** Compact readiness marker shared by recipe lists and planning surfaces. */
export function RecipeTrustBadge({ reviewState, inverted = false }: RecipeTrustBadgeProps) {
  const colors = useColors();
  const presentation = getRecipeTrustPresentation(reviewState);
  if (!presentation) return null;

  const foreground = inverted ? '#FFFFFF' : colors.warning;
  const background = inverted ? 'rgba(0,0,0,0.72)' : colors.warning + '16';

  return (
    <RNView
      style={[styles.badge, { backgroundColor: background }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={presentation.accessibilityLabel}
    >
      <Ionicons name="alert-circle-outline" size={12} color={foreground} />
      <Text style={[styles.label, { color: foreground }]}>{presentation.label}</Text>
    </RNView>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    minHeight: 24,
    marginVertical: 2,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
