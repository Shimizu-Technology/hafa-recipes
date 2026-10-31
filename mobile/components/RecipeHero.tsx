import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';

import { Text, useColors } from './Themed';
import { fontSize, radius, spacing } from '../constants/Colors';
import { getSourcePlayback } from '../lib/sourcePlayback';
import { getSourcePlaybackMode } from '../lib/sourcePlaybackConfig';
import { SourcePlaybackCard } from './SourcePlaybackCard';
import { RecipeThumbnail } from './RecipeThumbnail';

type RecipeHeroProps = {
  recipeTitle: string;
  sourceUrl: string;
  thumbnailUrl?: string | null;
  thumbnailPending?: boolean;
  onOpenSource: () => void;
  /** False renders the same layout with no taps or player, e.g. while the full recipe loads. */
  interactive?: boolean;
  photoOnly?: boolean;
};

/** A new source closes its player; photo updates preserve the current playback. */
export function RecipeHero(props: RecipeHeroProps) {
  const thumbnailUrl = props.thumbnailUrl?.trim() || null;
  return <RecipeHeroContent key={props.sourceUrl}
    {...props} thumbnailUrl={thumbnailUrl} />;
}

/** Give the food the lead; keep source access when a photo is missing or fails. */
function RecipeHeroContent({ recipeTitle, sourceUrl, thumbnailUrl, thumbnailPending = false, onOpenSource, interactive = true, photoOnly = false }: RecipeHeroProps) {
  const currentImage = useRef({ uri: thumbnailUrl });
  if (currentImage.current.uri !== thumbnailUrl) currentImage.current = { uri: thumbnailUrl };
  const imageIdentity = currentImage.current;
  const [failedImage, setFailedImage] = useState<typeof imageIdentity | null>(null);
  const colors = useColors();
  const playback = useMemo(() => getSourcePlayback(sourceUrl), [sourceUrl]);
  const usableThumbnailUrl = failedImage === imageIdentity ? null : thumbnailUrl;
  const handleImageError = () => {
    // Ignore callbacks from replaced images, including a later reuse of the same URI.
    if (currentImage.current === imageIdentity) setFailedImage(imageIdentity);
  };

  if (photoOnly && !usableThumbnailUrl && !thumbnailPending) return <RNView style={{ height: 120, backgroundColor: colors.background }} />;
  if (!playback && !usableThumbnailUrl && !thumbnailPending) return null;

  return (
    <RNView
      style={photoOnly ? styles.fullBleed : styles.container}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityElementsHidden={!interactive}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
    >
      {!usableThumbnailUrl && thumbnailPending && <Text
        accessibilityLiveRegion="polite"
        style={[styles.pendingText, { color: colors.textSecondary }]}
      >Choosing recipe photo…</Text>}
      {!photoOnly && playback ? <SourcePlaybackCard
        playback={playback}
        recipeTitle={recipeTitle}
        thumbnailUrl={usableThumbnailUrl}
        onThumbnailError={handleImageError}
        onOpenSource={onOpenSource}
        embeddedPlaybackEnabled={getSourcePlaybackMode() === 'embedded'}
      /> : usableThumbnailUrl ? <RecipeThumbnail
        key={usableThumbnailUrl}
        uri={usableThumbnailUrl}
        style={photoOnly ? styles.fullBleedImage : styles.heroImage}
        onError={handleImageError}
        accessibilityLabel={`${recipeTitle} recipe`}
        priority="high"
      /> : null}
    </RNView>
  );
}

const styles = StyleSheet.create({
  fullBleed: { width: '100%' },
  fullBleedImage: { width: '100%', aspectRatio: 1.2 },
  container: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pendingText: { fontSize: fontSize.sm, paddingVertical: spacing.sm },
  heroImage: { width: '100%', aspectRatio: 4 / 3, maxHeight: 340, maxWidth: (4 / 3) * 340, alignSelf: 'center', borderRadius: radius.xl },
});
