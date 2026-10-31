import type { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View, useWindowDimensions, type TouchableOpacityProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';

type RecipeDetailRowProps = Omit<TouchableOpacityProps, 'children' | 'style'> & {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value?: string;
  accessory?: ReactNode;
};

/** Shared anatomy for every row in recipe detail's More group. */
export function RecipeDetailRow({ icon, title, value, accessory, onPress, ...props }: RecipeDetailRowProps) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const content = <>
    <View style={styles.icon}><Ionicons name={icon} size={20} color={colors.actionText} /></View>
    <View style={styles.copy}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {value ? <Text style={[styles.value, { color: colors.textSecondary }]}>{value}</Text> : null}
    </View>
    {accessory ?? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
  </>;
  const style = [styles.row, { borderBottomColor: colors.border, gap: fontScale >= 2 ? 4 : 12 }];
  return onPress
    ? <TouchableOpacity accessibilityLabel={title} {...props} onPress={onPress} accessibilityRole={props.accessibilityRole ?? 'button'} activeOpacity={0.75} style={style}>{content}</TouchableOpacity>
    : <View style={style}>{content}</View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 20, alignItems: 'center' },
  copy: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4 },
  title: { fontSize: 17, lineHeight: 22, flexGrow: 1, flexShrink: 1 },
  value: { fontSize: 15, lineHeight: 20, flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
});
