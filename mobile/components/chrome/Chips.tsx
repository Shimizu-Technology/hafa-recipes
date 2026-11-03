import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';
import { MIN_TOUCH, touchInset } from '@/components/chrome/touch';
import { LookPressable } from '@/components/lookMotion';
import { useLook } from '@/contexts/LookContext';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const CHIP_HEIGHT = 34;

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
  const look = useLook();
  if (look.variants.chip !== 'current') {
    // Preview looks: selection is ink (the accent stays on primary actions); an alert is a neutral chip with a red dot.
    const outline = look.variants.chip === 'outline';
    const ink = selected ? colors.onInk : colors.text;
    return <LookPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} testID={testID}
      accessibilityState={selected === undefined ? undefined : { selected }} style={styles.target}>
      <View style={[styles.chip, { borderRadius: look.radii.chip },
        selected ? { backgroundColor: colors.ink }
          : outline ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }
            : [{ backgroundColor: colors.backgroundElevated }, look.shadows.card]]}>
        {tone === 'alert' && !selected && <View style={[styles.alertDot, { backgroundColor: colors.error }]} />}
        {icon && tone !== 'alert' && <Ionicons name={icon} size={16} color={selected ? ink : colors.textSecondary} />}
        <Text style={[styles.label, { color: ink }]}>{label}</Text>
      </View>
    </LookPressable>;
  }
  const color = selected ? colors.onTint : tone === 'alert' ? colors.error : colors.text;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} testID={testID}
    accessibilityState={selected === undefined ? undefined : { selected }}
    style={({ pressed }) => [styles.target, { opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.chip, { backgroundColor: selected ? colors.tint : colors.surface2 }]}>
      {icon && <Ionicons name={icon} size={16} color={color} />}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
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
  target: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  chip: { minHeight: CHIP_HEIGHT, borderRadius: CHIP_HEIGHT / 2, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  rowWrap: { marginHorizontal: -16, marginTop: -touchInset(CHIP_HEIGHT), marginBottom: 12 - touchInset(CHIP_HEIGHT) },
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  alertDot: { width: 8, height: 8, borderRadius: 4 },
  fade: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 24 },
});
