import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';

export type ChatScope = 'recipe' | 'all';

/**
 * The composer's context: "All recipes" off a recipe; on a recipe, "This recipe" and
 * "All recipes" so the cook can widen the question to the whole library.
 */
export function ChatScopeChips({ scope, canFocusRecipe, onChange }: { scope: ChatScope; canFocusRecipe: boolean; onChange: (scope: ChatScope) => void }) {
  const colors = useColors();
  const chips: { value: ChatScope; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    ...(canFocusRecipe ? [{ value: 'recipe' as const, label: 'This recipe', icon: 'restaurant-outline' as const }] : []),
    { value: 'all', label: 'All recipes', icon: 'library-outline' },
  ];
  return <View style={styles.row} accessibilityRole={canFocusRecipe ? 'radiogroup' : undefined} accessibilityLabel="What Håfa looks at">
    {chips.map(chip => {
      const selected = chip.value === scope;
      const tone = selected ? colors.actionText : colors.textSecondary;
      return <Pressable key={chip.value} disabled={!canFocusRecipe || selected} onPress={() => onChange(chip.value)}
        accessibilityRole={canFocusRecipe ? 'radio' : 'text'} accessibilityState={canFocusRecipe ? { selected } : undefined} accessibilityLabel={chip.label}
        style={[styles.chip, { backgroundColor: selected ? colors.chromeIndicator : colors.surface2 }]}>
        <Ionicons name={chip.icon} size={14} color={tone} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.label, { color: tone }]}>{chip.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 28, borderRadius: 14, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
