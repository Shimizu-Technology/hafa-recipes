import Ionicons from '@expo/vector-icons/Ionicons';
import {
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import {
  type GrocerySection,
  OTHER_GROCERY_SECTION_KEY,
} from '@/lib/grocerySections';

type GrocerySectionHeaderProps = {
  section: GrocerySection;
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenRecipe?: (recipeId: string) => void;
  onClearSection?: () => void;
};

/** Keeps recipe navigation distinct from section expansion and destructive actions. */
export function GrocerySectionHeader({
  section,
  isCollapsed,
  onToggle,
  onOpenRecipe,
  onClearSection,
}: GrocerySectionHeaderProps) {
  const colors = useColors();
  const isOther = section.key === OTHER_GROCERY_SECTION_KEY;
  const recipeId = section.recipeId;
  const canOpenRecipe = recipeId !== null && onOpenRecipe !== undefined;
  const canClear = section.recipeId !== null && onClearSection !== undefined;

  return (
    <RNView style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      <RNView style={styles.main}>
        <Ionicons
          name={isOther ? 'list-outline' : 'restaurant-outline'}
          size={18}
          color={colors.tint}
          style={styles.icon}
        />
        {canOpenRecipe ? (
          <TouchableOpacity
            style={styles.titleButton}
            onPress={() => onOpenRecipe(recipeId)}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={`Open ${section.title} recipe`}
          >
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {section.title}
            </Text>
            <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.tint} />
          </TouchableOpacity>
        ) : (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {section.title}
          </Text>
        )}
        <RNView style={[styles.badge, { backgroundColor: colors.tint + '20' }]}>
          <Text style={[styles.badgeText, { color: colors.tint }]}>
            {section.checkedCount}/{section.totalCount}
          </Text>
        </RNView>
      </RNView>

      <TouchableOpacity
        style={styles.iconButton}
        onPress={onToggle}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${section.title} grocery section`}
      >
        <Ionicons
          name={isCollapsed ? 'chevron-down' : 'chevron-up'}
          size={20}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {canClear && (
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onClearSection}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${section.title} grocery items`}
        >
          <Ionicons name="close-circle-outline" size={20} color={colors.error} />
        </TouchableOpacity>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  icon: {
    marginRight: spacing.sm,
  },
  titleButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  iconButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
});
