import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';
import type { ChatRecipeRef } from '@/types/recipe';

/** The user's recipes an answer mentions, as cards that open the recipe. */
export function ChatRecipeRefs({ refs, onOpen }: { refs: ChatRecipeRef[]; onOpen: (ref: ChatRecipeRef) => void }) {
  const colors = useColors();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  if (!refs.length) return null;
  // The message column shrink-wraps its content, so cards start from the window width (giving the
  // row a real size) and then fit the measured width. iOS 18 keeps a title's first measurement when
  // its card narrows, so the cards remount whenever their width changes.
  const cardWidth = Math.min(containerWidth || windowWidth - 48, fontScale >= 1.3 ? 320 : 280);
  return <ScrollView onLayout={event => setContainerWidth(event.nativeEvent.layout.width)} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}
    accessibilityLabel={`${refs.length} ${refs.length === 1 ? 'recipe' : 'recipes'} from your library`}>
    {refs.map(ref => <Pressable key={`${ref.id}-${cardWidth}`} onPress={() => onOpen(ref)} accessibilityRole="button" accessibilityLabel={`Open ${ref.title}`}
      testID={`chat-recipe-ref-${ref.id}`}
      style={({ pressed }) => [styles.card, { width: cardWidth, backgroundColor: colors.backgroundElevated, borderColor: colors.hairline, opacity: pressed ? 0.7 : 1 }]}>
      <RecipeThumbnail uri={ref.image_url} accessible={false} placeholderIconSize={20} style={styles.thumb} />
      <View style={styles.copy}>
        <Text numberOfLines={fontScale >= 1.3 ? 4 : 3} style={[styles.title, { color: colors.text }]}>{ref.title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 8, width: '100%' },
  row: { gap: 8 },
  card: { minHeight: 80, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  copy: { flex: 1 },
  title: { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold },
});
