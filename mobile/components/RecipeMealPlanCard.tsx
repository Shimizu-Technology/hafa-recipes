import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import type { MealPlanEntry } from '@/types/recipe';

const VISIBLE_ENTRY_LIMIT = 3;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type RecipeMealPlanCardProps = {
  entries: readonly MealPlanEntry[];
  isLoading: boolean;
  hasError?: boolean;
  isRetrying?: boolean;
  onOpenDate: (date: string) => void;
  onOpenPlanner: () => void;
  onRetry?: () => void;
};

/** Format an API calendar date without shifting it across time zones. */
export function formatMealPlanDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return `${WEEKDAYS[parsed.getDay()]}, ${MONTHS[month - 1]} ${day}`;
}

/** Shows upcoming planner relationships from a recipe record. */
export function RecipeMealPlanCard({
  entries,
  isLoading,
  hasError = false,
  isRetrying = false,
  onOpenDate,
  onOpenPlanner,
  onRetry,
}: RecipeMealPlanCardProps) {
  const colors = useColors();
  const visibleEntries = entries.slice(0, VISIBLE_ENTRY_LIMIT);
  const remainingCount = entries.length - visibleEntries.length;

  return (
    <RNView style={[
      styles.container,
      { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
    ]}>
      <RNView style={styles.header}>
        <RNView style={styles.titleRow}>
          <Ionicons name="calendar-outline" size={19} color={colors.tint} />
          <Text style={[styles.title, { color: colors.text }]}>Meal plan</Text>
        </RNView>
        <TouchableOpacity
          onPress={onOpenPlanner}
          style={[styles.openButton, { backgroundColor: colors.tint + '15' }]}
          accessibilityRole="link"
          accessibilityLabel="Open meal planner"
        >
          <Text style={[styles.openText, { color: colors.tint }]}>Open</Text>
          <Ionicons name="arrow-forward" size={15} color={colors.tint} />
        </TouchableOpacity>
      </RNView>

      {isLoading ? (
        <RNView style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text style={[styles.supportingText, { color: colors.textMuted }]}>Checking your plan...</Text>
        </RNView>
      ) : hasError ? (
        <RNView style={styles.errorRow}>
          <Text style={[styles.supportingText, styles.errorText, { color: colors.textMuted }]}>
            We couldn't load this recipe's upcoming plan.
          </Text>
          {onRetry && (
            <TouchableOpacity
              onPress={onRetry}
              disabled={isRetrying}
              style={[styles.retryButton, { borderColor: colors.tint }]}
              accessibilityRole="button"
              accessibilityLabel={isRetrying ? 'Retrying meal plan' : 'Retry loading meal plan'}
              accessibilityState={{ busy: isRetrying, disabled: isRetrying }}
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Ionicons name="refresh" size={15} color={colors.tint} />
              )}
              <Text style={[styles.retryText, { color: colors.tint }]}>
                {isRetrying ? 'Retrying...' : 'Retry'}
              </Text>
            </TouchableOpacity>
          )}
        </RNView>
      ) : visibleEntries.length > 0 ? (
        <RNView style={styles.entryLinks}>
          {visibleEntries.map((entry) => (
            <TouchableOpacity
              key={entry.id}
              style={[styles.entryLink, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => onOpenDate(entry.date)}
              accessibilityRole="link"
              accessibilityLabel={`Open meal plan for ${formatMealPlanDate(entry.date)}`}
            >
              <RNView style={[styles.dateIcon, { backgroundColor: colors.tint + '12' }]}>
                <Ionicons name="calendar-clear-outline" size={17} color={colors.tint} />
              </RNView>
              <RNView style={styles.entryText}>
                <Text style={[styles.dateText, { color: colors.text }]}>
                  {formatMealPlanDate(entry.date)}
                </Text>
                <Text style={[styles.mealType, { color: colors.textMuted }]}>
                  {entry.meal_type.charAt(0).toUpperCase() + entry.meal_type.slice(1)}
                </Text>
              </RNView>
              <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
          {remainingCount > 0 && (
            <Text style={[styles.moreText, { color: colors.textMuted }]}>
              {remainingCount} more upcoming {remainingCount === 1 ? 'date' : 'dates'} in your planner
            </Text>
          )}
        </RNView>
      ) : (
        <Text style={[styles.supportingText, { color: colors.textMuted }]}>
          This recipe is not on your upcoming plan yet.
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
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  openText: {
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
  errorRow: {
    alignItems: 'flex-start',
  },
  errorText: {
    marginBottom: spacing.sm,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  retryText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  entryLinks: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  entryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  dateIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryText: {
    flex: 1,
    gap: 2,
  },
  dateText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  mealType: {
    fontSize: fontSize.sm,
  },
  moreText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
});
