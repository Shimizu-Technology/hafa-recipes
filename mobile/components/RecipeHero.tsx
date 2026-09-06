import { StyleSheet } from 'react-native';

import { getSourcePlayback } from '../lib/sourcePlayback';
import { SOURCE_PLAYBACK_MODE } from '../lib/sourcePlaybackConfig';
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
  const normalizedThumbnailUrl = thumbnailUrl?.trim() || null;
  const usableThumbnailUrl = imageError ? null : normalizedThumbnailUrl;

  if (playback) {
    return (
      <SourcePlaybackCard
        playback={playback}
        recipeTitle={recipeTitle}
        thumbnailUrl={usableThumbnailUrl}
        onThumbnailError={onImageError}
        onOpenSource={onOpenSource}
        embeddedPlaybackEnabled={SOURCE_PLAYBACK_MODE === 'embedded'}
      />
    );
  }

  return (
    <RecipeThumbnail
      uri={usableThumbnailUrl}
      style={usableThumbnailUrl ? styles.heroImage : styles.placeholderHero}
      onError={onImageError}
      accessibilityLabel={usableThumbnailUrl
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
