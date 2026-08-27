import { Image, StyleSheet, View as RNView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useColors } from '@/components/Themed';
import { getSourcePlayback } from '../lib/sourcePlayback';
import { SourcePlaybackCard } from './SourcePlaybackCard';

type RecipeHeroProps = {
  recipeTitle: string;
  sourceUrl: string;
  thumbnailUrl?: string | null;
  imageError: boolean;
  onImageError: () => void;
  onOpenSource: () => void;
};

/** Select the playable, image, or placeholder hero for a recipe. */
export function RecipeHero({
  recipeTitle,
  sourceUrl,
  thumbnailUrl,
  imageError,
  onImageError,
  onOpenSource,
}: RecipeHeroProps) {
  const colors = useColors();
  const playback = getSourcePlayback(sourceUrl);

  if (playback) {
    return (
      <SourcePlaybackCard
        playback={playback}
        recipeTitle={recipeTitle}
        thumbnailUrl={imageError ? null : thumbnailUrl}
        onThumbnailError={onImageError}
        onOpenSource={onOpenSource}
      />
    );
  }

  if (thumbnailUrl && !imageError) {
    return (
      <Image
        source={{ uri: thumbnailUrl }}
        style={styles.heroImage}
        onError={onImageError}
        accessibilityLabel={`${recipeTitle} recipe`}
      />
    );
  }

  return (
    <RNView
      style={[styles.placeholderHero, { backgroundColor: colors.tint + '15' }]}
      accessibilityLabel={`${recipeTitle} recipe image placeholder`}
    >
      <Ionicons name="restaurant-outline" size={64} color={colors.tint} />
    </RNView>
  );
}

const styles = StyleSheet.create({
  heroImage: {
    width: '100%',
    height: 300,
  },
  placeholderHero: {
    width: '100%',
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
