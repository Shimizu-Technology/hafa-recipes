import Ionicons from '@expo/vector-icons/Ionicons';
import { ActionSheetIOS, Alert, Platform, TouchableOpacity, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import type { GrocerySection } from '@/lib/grocerySections';

type Props = { section: GrocerySection; isCollapsed: boolean; isCollapsible?: boolean; onToggle: () => void; onOpenRecipe?: (id: string) => void; onClearSection?: () => void };
export function GrocerySectionHeader({ section, isCollapsed, isCollapsible = true, onToggle, onOpenRecipe, onClearSection }: Props) {
  const colors = useColors();
  const openMenu = () => {
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [];
    if (section.recipeId && onOpenRecipe) actions.push({ text: 'Open recipe', onPress: () => onOpenRecipe(section.recipeId!) });
    if (isCollapsible) actions.push({ text: isCollapsed ? 'Expand section' : 'Collapse section', onPress: onToggle });
    if (section.recipeId && onClearSection) actions.push({ text: 'Remove recipe items', style: 'destructive', onPress: onClearSection });
    actions.push({ text: 'Cancel', style: 'cancel' });
    const title = `${section.title} · ${section.checkedCount}/${section.totalCount} checked`;
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title, options: actions.map(action => action.text), cancelButtonIndex: actions.length - 1, destructiveButtonIndex: actions.findIndex(action => action.style === 'destructive') }, index => actions[index]?.onPress?.());
    else Alert.alert(title, undefined, actions);
  };
  return <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
    <Text accessibilityRole="header" style={{ flex: 1, color: colors.textSecondary, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>{section.key === 'other-items' ? 'Other' : section.title}</Text>
    <TouchableOpacity onPress={openMenu} accessibilityRole="button" accessibilityLabel={`More actions for ${section.title}`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} /></TouchableOpacity>
  </View>;
}
