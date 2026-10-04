import { StyleSheet } from 'react-native';

import { getSourcePlayback } from '../lib/sourcePlayback';
import { getSourcePlaybackMode } from '../lib/sourcePlaybackConfig';
import { SourcePlaybackCard } from './SourcePlaybackCard';
import { RecipeThumbnail } from './RecipeThumbnail';

type RecipeHeroProps = {
  recipeTitle: string;
  sourceUrl: string;
  thumbnailUrl?: string | null;
  imageError: boolean;
  onImageError: () => void;
  onOpenSource: () => void;
  compact?: boolean;
};

/** Select the playable, image, or placeholder hero for a recipe. */
export function RecipeHero({
  recipeTitle,
  sourceUrl,
  thumbnailUrl,
  imageError,
  onImageError,
  onOpenSource,
  compact = false,
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
        embeddedPlaybackEnabled={getSourcePlaybackMode() === 'embedded'}
        compact={compact}
      />
    );
  }

  if (compact && !usableThumbnailUrl) return null;

  return (
    <RecipeThumbnail
      uri={usableThumbnailUrl}
      style={compact ? styles.compactImage : usableThumbnailUrl ? styles.heroImage : styles.placeholderHero}
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
  compactImage: { width: '100%', aspectRatio: 2.1, maxHeight: 220 },
  heroImage: {
    width: '100%',
    height: 300,
  },
  placeholderHero: {
    width: '100%',
    height: 200,
  },
});
