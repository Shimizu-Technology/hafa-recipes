import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** A 34pt filter/status pill: tonal at rest, accent-filled when selected. */
export function Chip({ label, onPress, selected, icon, tone = 'default', accessibilityLabel, testID }: {
  label: string;
  onPress: () => void;
  /** Present for on/off filters; omit for chips that navigate. */
  selected?: boolean;
  icon?: IconName;
  tone?: 'default' | 'alert';
  accessibilityLabel?: string;
  testID?: string;
}) {
  const colors = useColors();
  const color = selected ? colors.onTint : tone === 'alert' ? colors.error : colors.text;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} testID={testID}
    accessibilityState={selected === undefined ? undefined : { selected }}
    style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.tint : colors.surface2, opacity: pressed ? 0.7 : 1 }]}>
    {icon && <Ionicons name={icon} size={16} color={color} />}
    <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
  </Pressable>;
}

/** One horizontally scrolling chip row that fades at the trailing edge instead of clipping a word. */
export function ChipRow({ children, accessibilityLabel }: { children: React.ReactNode; accessibilityLabel?: string }) {
  const colors = useColors();
  return <View style={styles.rowWrap} accessibilityLabel={accessibilityLabel}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>{children}</ScrollView>
    <LinearGradient pointerEvents="none" colors={[`${colors.background}00`, colors.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fade} />
  </View>;
}

const styles = StyleSheet.create({
  chip: { minHeight: 34, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  rowWrap: { marginHorizontal: -16, marginBottom: 12 },
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  fade: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 24 },
});
