import { useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions, type TouchableOpacityProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, TextScaleContext, useColors } from '@/components/Themed';

type RecipeDetailRowProps = Omit<TouchableOpacityProps, 'children' | 'style'> & {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value?: string;
  accessory?: ReactNode;
  /**
   * Action-list layout: the value is a left-aligned line directly under the title, truncated to one line
   * (two at accessibility text sizes), and the icon, text and chevron are centered in the row.
   */
  stacked?: boolean;
};

/** Shared anatomy for every row in recipe detail's More group. */
export function RecipeDetailRow({ icon, title, value, accessory, stacked, onPress, ...props }: RecipeDetailRowProps) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const textScale = useContext(TextScaleContext);
  const valueLines = fontScale * textScale >= 1.6 ? 2 : 1;
  const content = <>
    <View style={styles.icon}><Ionicons name={icon} size={20} color={colors.textSecondary} /></View>
    {stacked ? (
      <View style={styles.stackedCopy}>
        <Text style={[styles.stackedTitle, { color: colors.text }]}>{title}</Text>
        {value ? <Text numberOfLines={valueLines} ellipsizeMode="tail" style={[styles.stackedValue, { color: colors.textSecondary }]}>{value}</Text> : null}
      </View>
    ) : (
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {value ? <Text style={[styles.value, { color: colors.textSecondary }]}>{value}</Text> : null}
      </View>
    )}
    <View style={styles.accessory}>{accessory ?? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}</View>
    <View pointerEvents="none" style={[styles.separator, { backgroundColor: colors.border }]} />
  </>;
  const style = [styles.row, { gap: fontScale >= 2 ? 4 : 12 }];
  return onPress
    ? <TouchableOpacity accessibilityLabel={title} {...props} onPress={onPress} accessibilityRole={props.accessibilityRole ?? 'button'} activeOpacity={0.75} style={style}>{content}</TouchableOpacity>
    : <View style={style}>{content}</View>;
}

/** Secondary action under Start cooking (Plan, Groceries, Scale): a white sheet with a hairline; shares the row evenly. */
export function RecipeDetailAction({ icon, title, onPress, selected }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const textScale = useContext(TextScaleContext);
  const tint = selected ? colors.actionText : colors.text;
  return (
    <Pressable key={fontScale} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={selected === undefined ? undefined : { expanded: selected }}
      style={({ pressed }) => [styles.action, { flexBasis: Math.ceil(110 * fontScale * textScale) }, { backgroundColor: selected ? colors.accentTint : colors.backgroundElevated, borderColor: selected ? 'transparent' : colors.border }, pressed && styles.pressed]}>
      <Ionicons name={icon} size={16} color={tint} />
      <Text numberOfLines={1} style={[styles.actionTitle, { color: tint }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Figtree runs wider than SF; 8pt insets keep "Groceries" whole on a 402pt phone.
  action: { flexGrow: 1, flexShrink: 1, maxWidth: '100%', flexBasis: 96, minHeight: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  actionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  pressed: { opacity: 0.7 },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  separator: { position: 'absolute', left: 48, right: 16, bottom: 0, height: StyleSheet.hairlineWidth },
  icon: { width: 20, alignItems: 'center' },
  accessory: { flexShrink: 0, alignItems: 'center' },
  copy: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4 },
  title: { fontSize: 17, lineHeight: 22, flexGrow: 1, flexShrink: 1 },
  value: { fontSize: 15, lineHeight: 20, flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
  // No flexGrow on the title here: in a column it would stretch and push the value down.
  stackedCopy: { flex: 1, justifyContent: 'center', gap: 2 },
  stackedTitle: { fontSize: 17, lineHeight: 22 },
  stackedValue: { fontSize: 15, lineHeight: 20, textAlign: 'left' },
});
