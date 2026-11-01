import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';
import type { ChatRecipeRef } from '@/types/recipe';

/** The user's recipes an answer mentions, as cards that open the recipe. */
export function ChatRecipeRefs({ refs, onOpen }: { refs: ChatRecipeRef[]; onOpen: (ref: ChatRecipeRef) => void }) {
  const colors = useColors();
  if (!refs.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}
    accessibilityLabel={`${refs.length} ${refs.length === 1 ? 'recipe' : 'recipes'} from your library`}>
    {refs.map(ref => <Pressable key={ref.id} onPress={() => onOpen(ref)} accessibilityRole="button" accessibilityLabel={`Open ${ref.title}`}
      testID={`chat-recipe-ref-${ref.id}`}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.backgroundSecondary, opacity: pressed ? 0.7 : 1 }]}>
      <RecipeThumbnail uri={ref.image_url} accessible={false} placeholderIconSize={20} style={[styles.thumb, { backgroundColor: colors.surface2 }]} />
      <View style={styles.copy}>
        <Text numberOfLines={2} maxFontSizeMultiplier={1.4} style={[styles.title, { color: colors.text }]}>{ref.title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 8 },
  row: { gap: 8 },
  card: { width: 240, minHeight: 72, borderRadius: 16, padding: 8, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  copy: { flex: 1 },
  title: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.displaySemibold },
});
