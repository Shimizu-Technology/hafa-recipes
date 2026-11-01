import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Text, useColors } from '@/components/Themed';

const FIELD_HEIGHT = 40;

/** A 40pt tonal search field for filtering the list it sits above. */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel }: { value: string; onChangeText: (text: string) => void; placeholder: string; accessibilityLabel?: string }) {
  const colors = useColors();
  return <View style={[styles.field, { backgroundColor: colors.surface2 }]}>
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
  const router = useRouter();
  return <Pressable onPress={() => router.push('/search')} accessibilityRole="search" accessibilityLabel={placeholder} accessibilityHint="Opens search"
    testID="search-launcher" style={({ pressed }) => [styles.field, { backgroundColor: colors.surface2, opacity: pressed ? 0.7 : 1 }]}>
    <Ionicons name="search" size={18} color={colors.textMuted} />
    <Text numberOfLines={1} style={[styles.placeholder, { color: colors.textMuted }]}>{placeholder}</Text>
  </Pressable>;
}

/** A 40pt round filter button beside the search field, with an accent count when filters are on. */
export function FilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={count ? `Filter, ${count} on` : 'Filter'} testID="filter-button"
    style={({ pressed }) => [styles.filter, { backgroundColor: count ? colors.chromeIndicator : colors.surface2, opacity: pressed ? 0.7 : 1 }]}>
    <Ionicons name="options-outline" size={20} color={count ? colors.actionText : colors.text} />
    {count > 0 && <View style={[styles.badge, { backgroundColor: colors.tint }]}>
      <Text maxFontSizeMultiplier={1} style={[styles.badgeText, { color: colors.onTint }]}>{count}</Text>
    </View>}
  </Pressable>;
}

/** Search field and filter button on one row. */
export function SearchRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  field: { flex: 1, minHeight: FIELD_HEIGHT, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 17, paddingVertical: 8 },
  placeholder: { flex: 1, fontSize: 17, lineHeight: 22 },
  filter: { width: FIELD_HEIGHT, height: FIELD_HEIGHT, borderRadius: FIELD_HEIGHT / 2, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
