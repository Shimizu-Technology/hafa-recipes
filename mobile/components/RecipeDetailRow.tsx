import { useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions, type TouchableOpacityProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, TextScaleContext, useColors } from '@/components/Themed';
import { useLook } from '@/contexts/LookContext';

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
    <View style={styles.accessory}>{accessory ?? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}</View>
    <View pointerEvents="none" style={[styles.separator, { backgroundColor: colors.border }]} />
  </>;
  const style = [styles.row, { gap: fontScale >= 2 ? 4 : 12 }];
  return onPress
    ? <TouchableOpacity accessibilityLabel={title} {...props} onPress={onPress} accessibilityRole={props.accessibilityRole ?? 'button'} activeOpacity={0.75} style={style}>{content}</TouchableOpacity>
    : <View style={style}>{content}</View>;
}

/** Tonal secondary action under Start cooking (Plan, Groceries, Scale); shares the row evenly. */
export function RecipeDetailAction({ icon, title, onPress, selected, onBand = false }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  selected?: boolean;
  /** Sits on Island's deep-reef band: translucent white fill and white text. */
  onBand?: boolean;
}) {
  const colors = useColors();
  const look = useLook();
  const { fontScale } = useWindowDimensions();
  const textScale = useContext(TextScaleContext);
  const tint = onBand ? colors.onPhoto : selected ? colors.actionText : colors.text;
  // Cookbook: hairline outline on paper. Calm: white sheet with a hairline. Island on the band: white at 14%.
  const surface = look.id === 'current' ? null
    : onBand ? { backgroundColor: selected ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.14)', borderRadius: look.radii.button }
      : look.variants.card === 'flat' ? { backgroundColor: selected ? colors.accentTint : 'transparent', borderWidth: 1, borderColor: colors.border, borderRadius: look.radii.button }
        : { backgroundColor: selected ? colors.accentTint : colors.backgroundElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: look.radii.button };
  return (
    <Pressable key={fontScale} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={selected === undefined ? undefined : { expanded: selected }}
      style={({ pressed }) => [styles.action, { flexBasis: Math.ceil(110 * fontScale * textScale) }, { backgroundColor: selected ? colors.accentTint : colors.surface2 }, surface, surface && styles.lookAction, pressed && styles.pressed]}>
      <Ionicons name={icon} size={surface ? 16 : 18} color={tint} />
      <Text numberOfLines={1} style={[styles.actionTitle, { color: tint }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { flexGrow: 1, flexShrink: 1, maxWidth: '100%', flexBasis: 96, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  // Preview faces run wider than SF; tighter insets keep "Groceries" whole on a 402pt phone.
  lookAction: { paddingHorizontal: 8, gap: 5 },
  pressed: { opacity: 0.7 },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  separator: { position: 'absolute', left: 48, right: 16, bottom: 0, height: StyleSheet.hairlineWidth },
  icon: { width: 20, alignItems: 'center' },
  accessory: { flexShrink: 0, alignItems: 'center' },
  copy: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4 },
  title: { fontSize: 17, lineHeight: 22, flexGrow: 1, flexShrink: 1 },
  value: { fontSize: 15, lineHeight: 20, flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
});
