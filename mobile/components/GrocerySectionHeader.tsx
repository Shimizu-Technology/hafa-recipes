import { useContext, useEffect, useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActionSheetIOS, Alert, Animated, Easing, Platform, Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Text, TextScaleContext, useColors } from '@/components/Themed';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { sectionProgressLabel } from '@/lib/groceryCollapse';
import { OTHER_GROCERY_SECTION_KEY, type GrocerySection } from '@/lib/grocerySections';

type MenuAction = { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' };
type Props = {
  onShowMenu?: (actions: MenuAction[]) => void;
  /** Counts come from the whole list, so a filtered view still shows what is left. */
  section: GrocerySection;
  isCollapsed: boolean;
  /** False while searching: every match stays visible. */
  isCollapsible?: boolean;
  onToggle: () => void;
  onOpenRecipe?: (id: string) => void;
  onClearSection?: () => void;
  /** Position in the one grocery sheet: the first header rounds its top, a collapsed last one its bottom. */
  first?: boolean;
  last?: boolean;
};

/**
 * A recipe's row in the grocery sheet. Tapping anywhere on it folds or unfolds
 * the recipe's items; the chevron sits in the checkbox column so titles line
 * up with item names. Less common actions live behind "…" or a long press.
 */
export function GrocerySectionHeader({ section, isCollapsed, isCollapsible = true, onToggle, onOpenRecipe, onClearSection, onShowMenu, first = false, last = false }: Props) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const { fontScale } = useWindowDimensions();
  const textScale = useContext(TextScaleContext);
  // At accessibility sizes the count moves under the title instead of squeezing it.
  const stacked = fontScale * textScale >= 1.35;
  const title = section.key === OTHER_GROCERY_SECTION_KEY ? 'Other' : section.title;
  const progress = sectionProgressLabel(section);
  const folded = isCollapsible && isCollapsed;

  const rotation = useRef(new Animated.Value(folded ? 0 : 1)).current;
  useEffect(() => {
    const toValue = folded ? 0 : 1;
    if (reduceMotion) rotation.setValue(toValue);
    else Animated.timing(rotation, { toValue, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [folded, reduceMotion, rotation]);
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });

  const actions: MenuAction[] = [];
  if (section.recipeId && onOpenRecipe) actions.push({ text: 'Open recipe', onPress: () => onOpenRecipe(section.recipeId!) });
  if (section.recipeId && onClearSection) actions.push({ text: 'Remove recipe items', style: 'destructive', onPress: onClearSection });
  const hasMenu = actions.length > 0;
  const openMenu = () => {
    if (!hasMenu) return;
    const options = [...actions, { text: 'Cancel', style: 'cancel' as const }];
    const menuTitle = `${title} · ${section.checkedCount} of ${section.totalCount} checked`;
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: menuTitle, options: options.map(action => action.text), cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.findIndex(action => action.style === 'destructive') }, index => options[index]?.onPress?.());
    else if (onShowMenu) onShowMenu(options);
    else Alert.alert(menuTitle, undefined, options);
  };

  const label = <View style={[styles.labelRow, stacked && styles.labelStacked]}>
    {/* A long word at the largest sizes wraps instead of truncating. */}
    <Text numberOfLines={stacked ? undefined : 2} style={[styles.title, { color: colors.text }]}>{title}</Text>
    <Text numberOfLines={1} style={[styles.count, { color: colors.textSecondary }, !stacked && styles.countInline]}>{progress}</Text>
  </View>;

  return <View style={[styles.row, { backgroundColor: colors.backgroundElevated },
    first ? styles.firstRow : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
    last && folded && styles.lastFoldedRow]}>
    {isCollapsible
      ? <Pressable onPress={onToggle} onLongPress={hasMenu ? openMenu : undefined} delayLongPress={350}
        accessibilityRole="button" accessibilityState={{ expanded: !folded }}
        accessibilityLabel={`${title}, ${progress}`}
        accessibilityHint={folded ? 'Shows these items' : 'Hides these items'}
        style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: colors.surface2 }]}>
        <View style={[styles.chevron, stacked && styles.pinTop]}>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
          </Animated.View>
        </View>
        {label}
      </Pressable>
      : <View accessible accessibilityRole="header" accessibilityLabel={`${title}, ${progress}`} style={styles.toggle}>
        <View style={[styles.chevron, stacked && styles.pinTop]} />
        {label}
      </View>}
    {/* Every header keeps this column so the counts line up. */}
    {hasMenu
      ? <TouchableOpacity onPress={openMenu} accessibilityRole="button" accessibilityLabel={`More actions for ${title}`} style={[styles.menu, stacked && styles.pinTop]}>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      : <View style={styles.menu} />}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', paddingRight: 4, overflow: 'hidden' },
  firstRow: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  lastFoldedRow: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 8, paddingLeft: 6 },
  // Same 44pt column and 60pt text inset as the item checkboxes below.
  chevron: { width: 44, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  labelRow: { flex: 1, flexDirection: 'row', alignItems: 'baseline' },
  labelStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  title: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  count: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  countInline: { marginLeft: 'auto', paddingLeft: 12, flexShrink: 0 },
  // Tall accessibility-size headers keep their controls beside the first line.
  pinTop: { alignSelf: 'flex-start', minHeight: 44 },
  menu: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
