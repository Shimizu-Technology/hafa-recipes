import Ionicons from '@expo/vector-icons/Ionicons';
import { ActionSheetIOS, Alert, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import type { GrocerySection } from '@/lib/grocerySections';

type MenuAction = { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' };
type Props = { onShowMenu?: (actions: MenuAction[]) => void; section: GrocerySection; isCollapsed: boolean; isCollapsible?: boolean; onToggle: () => void; onOpenRecipe?: (id: string) => void; onClearSection?: () => void;
  /** Position in the one grocery sheet: the first header rounds its top, a collapsed last one its bottom. */
  first?: boolean; last?: boolean };
export function GrocerySectionHeader({ section, isCollapsed, isCollapsible = true, onToggle, onOpenRecipe, onClearSection, onShowMenu, first = false, last = false }: Props) {
  const colors = useColors();
  const openMenu = () => {
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [];
    if (section.recipeId && onOpenRecipe) actions.push({ text: 'Open recipe', onPress: () => onOpenRecipe(section.recipeId!) });
    if (isCollapsible) actions.push({ text: isCollapsed ? 'Expand section' : 'Collapse section', onPress: onToggle });
    if (section.recipeId && onClearSection) actions.push({ text: 'Remove recipe items', style: 'destructive', onPress: onClearSection });
    actions.push({ text: 'Cancel', style: 'cancel' });
    const title = `${section.title} · ${section.checkedCount}/${section.totalCount} checked`;
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title, options: actions.map(action => action.text), cancelButtonIndex: actions.length - 1, destructiveButtonIndex: actions.findIndex(action => action.style === 'destructive') }, index => actions[index]?.onPress?.());
    else if (onShowMenu) onShowMenu(actions);
    else Alert.alert(title, undefined, actions);
  };
  // A subhead inside the grocery sheet, ruled off from the section above it.
  return <View style={[{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, paddingTop: first ? 4 : 12, backgroundColor: colors.backgroundElevated },
    first ? { borderTopLeftRadius: 16, borderTopRightRadius: 16 } : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
    last && isCollapsed && { borderBottomLeftRadius: 16, borderBottomRightRadius: 16, paddingBottom: 4 }]}>
    <Text accessibilityRole="header" style={{ flex: 1, color: colors.textSecondary, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>{section.key === 'other-items' ? 'Other' : section.title}</Text>
    <TouchableOpacity onPress={openMenu} accessibilityRole="button" accessibilityLabel={`More actions for ${section.title}`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} /></TouchableOpacity>
  </View>;
}
