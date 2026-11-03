import { TextInput } from '@/components/Themed';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Text, useColors } from '@/components/Themed';
import { touchInset } from '@/components/chrome/touch';
import { useLook } from '@/contexts/LookContext';
import type { LookPalette, Look } from '@/constants/looks';

/** Field fill per look: Current tonal, Cookbook a hairline outline on paper, Island a white raised field, Calm a white field with a hairline. */
function fieldSurface(look: Look, colors: LookPalette, round = false) {
  if (look.id === 'current') return { backgroundColor: colors.surface2 };
  const radius = round ? 20 : look.radii.field;
  if (look.variants.chip === 'outline' && look.variants.card === 'flat') return { borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' };
  if (look.variants.card === 'raised') return { borderRadius: radius, backgroundColor: colors.backgroundElevated, ...look.shadows.card };
  return { borderRadius: radius, backgroundColor: colors.backgroundElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border };
}

const FIELD_HEIGHT = 40;
const OVERHANG = touchInset(FIELD_HEIGHT);
/** 40pt controls per the spec; the row is padded so this slop stays inside it and works on Android too. */
const FIELD_HIT_SLOP = { top: OVERHANG, bottom: OVERHANG, left: OVERHANG * 2 };

/** A 40pt tonal search field for filtering the list it sits above. */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel }: { value: string; onChangeText: (text: string) => void; placeholder: string; accessibilityLabel?: string }) {
  const colors = useColors();
  const look = useLook();
  return <View style={[styles.field, fieldSurface(look, colors)]}>
    <Ionicons name="search" size={18} color={colors.textMuted} />
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textMuted}
      accessibilityLabel={accessibilityLabel ?? placeholder} returnKeyType="search" autoCorrect={false} clearButtonMode="never"
      style={[styles.input, { color: colors.text }]} testID="search-field" />
    {value.length > 0 && <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
      <Ionicons name="close-circle" size={18} color={colors.textMuted} />
    </Pressable>}
  </View>;
}

/** The same field look, opening the Search screen (My recipes and Discover together). */
export function SearchLauncher({ placeholder = 'Search recipes' }: { placeholder?: string }) {
  const colors = useColors();
  const look = useLook();
  const router = useRouter();
  return <Pressable onPress={() => router.push('/search')} accessibilityRole="search" accessibilityLabel={placeholder} accessibilityHint="Opens search"
    testID="search-launcher" hitSlop={FIELD_HIT_SLOP} style={({ pressed }) => [styles.field, fieldSurface(look, colors), { opacity: pressed ? 0.7 : 1 }]}>
    <Ionicons name="search" size={18} color={colors.textMuted} />
    <Text style={[styles.placeholder, { color: colors.textMuted }]}>{placeholder}</Text>
  </Pressable>;
}

/** A 40pt round filter button beside the search field, with an accent count when filters are on. */
export function FilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  const look = useLook();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={count ? `Filter, ${count} on` : 'Filter'} testID="filter-button" hitSlop={FIELD_HIT_SLOP}
    style={({ pressed }) => [styles.filter, fieldSurface(look, colors, true), count ? { backgroundColor: colors.chromeIndicator } : null, { opacity: pressed ? 0.7 : 1 }]}>
    <Ionicons name="options-outline" size={20} color={count ? colors.actionText : colors.text} />
    {count > 0 && <View style={[styles.badge, { backgroundColor: colors.tint }]}>
      <Text style={[styles.badgeText, { color: colors.onTint }]}>{count}</Text>
    </View>}
  </Pressable>;
}

/** Search field and filter button on one row. */
export function SearchRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: OVERHANG, marginTop: -OVERHANG, marginBottom: 12 - OVERHANG },
  field: { flex: 1, minHeight: FIELD_HEIGHT, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 17, paddingVertical: 8 },
  placeholder: { flex: 1, fontSize: 17, lineHeight: 22 },
  filter: { width: FIELD_HEIGHT, height: FIELD_HEIGHT, borderRadius: FIELD_HEIGHT / 2, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, minHeight: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
