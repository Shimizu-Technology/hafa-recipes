import { StyleSheet } from 'react-native';

import { getSourcePlayback } from '../lib/sourcePlayback';
import { SourcePlaybackCard } from './SourcePlaybackCard';
import { RecipeThumbnail } from './RecipeThumbnail';

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

  return (
    <RecipeThumbnail
      uri={imageError ? null : thumbnailUrl}
      style={thumbnailUrl && !imageError ? styles.heroImage : styles.placeholderHero}
      onError={onImageError}
      accessibilityLabel={thumbnailUrl && !imageError
        ? `${recipeTitle} recipe`
        : `${recipeTitle} recipe image placeholder`}
      placeholderIconSize={64}
      priority="high"
    />
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
  },
});
