import { ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';
import { MIN_TOUCH, touchInset } from '@/components/chrome/touch';
import { PressScale } from '@/components/chrome/motion';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const CHIP_HEIGHT = 34;

/**
 * A 34pt filter/status chip: a hairline outline at rest and an ink fill when selected, so the accent
 * stays on primary actions. An alert is a neutral chip with a small red dot, not a red chip.
 */
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
  const color = selected ? colors.onInk : colors.text;
  return <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} testID={testID}
    accessibilityState={selected === undefined ? undefined : { selected }}
    style={styles.target}>
    <View style={[styles.chip, selected ? { backgroundColor: colors.ink } : { borderWidth: 1, borderColor: colors.border }]}>
      {tone === 'alert' && !selected && <View style={[styles.alertDot, { backgroundColor: colors.error }]} />}
      {icon && !(tone === 'alert' && !selected) && <Ionicons name={icon} size={16} color={selected ? color : colors.textSecondary} />}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  </PressScale>;
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
  target: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  chip: { minHeight: CHIP_HEIGHT, borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  rowWrap: { marginHorizontal: -16, marginTop: -touchInset(CHIP_HEIGHT), marginBottom: 12 - touchInset(CHIP_HEIGHT) },
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  alertDot: { width: 8, height: 8, borderRadius: 4 },
  fade: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 24 },
});
