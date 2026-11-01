import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';
import type { Collection } from '@/types/recipe';

const GAP = 12;
const SIDE = 16;

function useTileWidth() {
  const { width, fontScale } = useWindowDimensions();
  const content = Math.min(width, 720) - SIDE * 2;
  return fontScale >= 1.3 ? content : (content - GAP) / 2;
}

const recipeCount = (count: number) => `${count} ${count === 1 ? 'recipe' : 'recipes'}`;

/** A square cover: one wide photo over two half photos, or fewer photos filling the space. */
function Mosaic({ thumbnails }: { thumbnails: string[] }) {
  const colors = useColors();
  if (!thumbnails.length) {
    return <View style={[styles.cover, styles.empty, { backgroundColor: colors.chromeIndicator }]}>
      <Ionicons name="folder-open-outline" size={32} color={colors.actionText} />
    </View>;
  }
  const photo = (uri: string, style: object) => <RecipeThumbnail uri={uri} accessible={false} placeholderIconSize={20} style={[style, { backgroundColor: colors.surface2 }]} />;
  if (thumbnails.length === 1) return <View style={styles.cover}>{photo(thumbnails[0], styles.fill)}</View>;
  const [top, ...rest] = thumbnails;
  return <View style={[styles.cover, styles.stack]}>
    {photo(top, styles.top)}
    <View style={styles.bottomRow}>
      {rest.slice(0, 2).map((uri, index) => <View key={`${uri}-${index}`} style={styles.half}>{photo(uri, styles.fill)}</View>)}
    </View>
  </View>;
}

export function CollectionCard({ collection, onPress }: { collection: Collection; onPress: () => void }) {
  const colors = useColors();
  const width = useTileWidth();
  const thumbnails = (collection.preview_thumbnails ?? []).filter((uri): uri is string => Boolean(uri?.trim()));
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${collection.name}, ${recipeCount(collection.recipe_count)}`}
    testID={`collection-${collection.id}`} style={({ pressed }) => [{ width, opacity: pressed ? 0.75 : 1 }]}>
    <Mosaic thumbnails={thumbnails} />
    <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{collection.name}</Text>
    <Text style={[styles.count, { color: colors.textSecondary }]}>{recipeCount(collection.recipe_count)}</Text>
  </Pressable>;
}

export function NewCollectionTile({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  const width = useTileWidth();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="New collection" testID="new-collection"
    style={({ pressed }) => [{ width, opacity: pressed ? 0.75 : 1 }]}>
    <View style={[styles.cover, styles.empty, styles.dashed, { borderColor: colors.border }]}>
      <View style={[styles.plus, { backgroundColor: colors.surface2 }]}><Ionicons name="add" size={26} color={colors.text} /></View>
    </View>
    <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>New collection</Text>
  </Pressable>;
}

/** Two-column collection covers with a "New collection" tile first. */
export function CollectionGrid({ collections, onOpen, onCreate }: { collections: Collection[]; onOpen: (collection: Collection) => void; onCreate: () => void }) {
  return <View style={styles.grid}>
    <NewCollectionTile onPress={onCreate} />
    {collections.map(collection => <CollectionCard key={collection.id} collection={collection} onPress={() => onOpen(collection)} />)}
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 20 },
  cover: { width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden' },
  stack: { gap: 2 },
  fill: { width: '100%', height: '100%' },
  top: { width: '100%', flex: 1.2 },
  bottomRow: { flex: 1, flexDirection: 'row', gap: 2 },
  half: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  dashed: { borderWidth: 1.5, borderStyle: 'dashed' },
  plus: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 8, fontSize: 16, lineHeight: 21, fontFamily: fontFamily.displaySemibold },
  count: { fontSize: 13, lineHeight: 18 },
});
