import { Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Text, useColors } from '@/components/Themed';

/** A 40pt search field that opens Search, so finding a recipe is one visible tap from Library and Discover. */
export function SearchLauncher({ placeholder = 'Search recipes' }: { placeholder?: string }) {
  const colors = useColors();
  const router = useRouter();
  return <Pressable onPress={() => router.push('/search')} accessibilityRole="search" accessibilityLabel={placeholder} accessibilityHint="Opens search"
    testID="search-launcher" style={({ pressed }) => [styles.field, { backgroundColor: colors.surface2, opacity: pressed ? 0.7 : 1 }]}>
    <Ionicons name="search" size={18} color={colors.textMuted} />
    <Text numberOfLines={1} style={[styles.placeholder, { color: colors.textMuted }]}>{placeholder}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  field: { minHeight: 40, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  placeholder: { flex: 1, fontSize: 17, lineHeight: 22 },
});
