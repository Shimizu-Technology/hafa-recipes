import { useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';

import { radius, spacing } from '../constants/Colors';
import { getSourcePlayback } from '../lib/sourcePlayback';
import { getSourcePlaybackMode } from '../lib/sourcePlaybackConfig';
import { SourcePlaybackCard } from './SourcePlaybackCard';
import { RecipeThumbnail } from './RecipeThumbnail';

type RecipeHeroProps = {
  recipeTitle: string;
  sourceUrl: string;
  thumbnailUrl?: string | null;
  onOpenSource: () => void;
};

/** Changing the image/source remounts its state, isolating late image failures and open players. */
export function RecipeHero(props: RecipeHeroProps) {
  const thumbnailUrl = props.thumbnailUrl?.trim() || null;
  return <RecipeHeroContent key={JSON.stringify([props.sourceUrl, thumbnailUrl])}
    {...props} thumbnailUrl={thumbnailUrl} />;
}

/** Give the food the lead; keep source access when a photo is missing or fails. */
function RecipeHeroContent({ recipeTitle, sourceUrl, thumbnailUrl, onOpenSource }: RecipeHeroProps) {
  const [imageError, setImageError] = useState(false);
  const playback = getSourcePlayback(sourceUrl);
  const usableThumbnailUrl = imageError ? null : thumbnailUrl;

  if (!playback && !usableThumbnailUrl) return null;

  return (
    <RNView style={styles.container}>
      {playback ? <SourcePlaybackCard
        playback={playback}
        recipeTitle={recipeTitle}
        thumbnailUrl={usableThumbnailUrl}
        onThumbnailError={() => setImageError(true)}
        onOpenSource={onOpenSource}
        embeddedPlaybackEnabled={getSourcePlaybackMode() === 'embedded'}
      /> : <RecipeThumbnail
        uri={usableThumbnailUrl}
        style={styles.heroImage}
        onError={() => setImageError(true)}
        accessibilityLabel={`${recipeTitle} recipe`}
        priority="high"
      />}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  heroImage: { width: '100%', aspectRatio: 4 / 3, maxHeight: 340, borderRadius: radius.xl },
});
