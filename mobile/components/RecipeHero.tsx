import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

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

  // Full-bleed detail photo. No photo renders nothing, so the screen falls back to an opaque header.
  if (photoOnly) {
    if (!usableThumbnailUrl && !thumbnailPending) return null;
    return <RNView style={[styles.fullBleedImage, { backgroundColor: colors.backgroundSecondary }]}>
      {usableThumbnailUrl ? <RecipeThumbnail key={usableThumbnailUrl} uri={usableThumbnailUrl} style={StyleSheet.absoluteFill}
        onError={handleImageError} accessibilityLabel={`${recipeTitle} recipe`} priority="high" />
        : <RNView style={styles.pendingTile}><Text accessibilityLiveRegion="polite"
          style={[styles.pendingText, { color: colors.textSecondary }]}>Choosing recipe photo…</Text></RNView>}
      {/* Keeps the status bar and header circles legible on pale photos. */}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']} style={styles.scrim} />
    </RNView>;
  }
  if (!playback && !usableThumbnailUrl && !thumbnailPending) return null;

  return (
    <RNView
      style={styles.container}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityElementsHidden={!interactive}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
    >
      {!usableThumbnailUrl && thumbnailPending && <Text
        accessibilityLiveRegion="polite"
        style={[styles.pendingText, { color: colors.textSecondary }]}
      >Choosing recipe photo…</Text>}
      {playback ? <SourcePlaybackCard
        playback={playback}
        recipeTitle={recipeTitle}
        thumbnailUrl={usableThumbnailUrl}
        onThumbnailError={handleImageError}
        onOpenSource={onOpenSource}
        embeddedPlaybackEnabled={getSourcePlaybackMode() === 'embedded'}
      /> : usableThumbnailUrl ? <RecipeThumbnail
        key={usableThumbnailUrl}
        uri={usableThumbnailUrl}
        style={styles.heroImage}
        onError={handleImageError}
        accessibilityLabel={`${recipeTitle} recipe`}
        priority="high"
      /> : null}
    </RNView>
  );
}

const styles = StyleSheet.create({
  fullBleedImage: { width: '100%', aspectRatio: 4 / 3, overflow: 'hidden' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  pendingTile: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pendingText: { fontSize: fontSize.sm, paddingVertical: spacing.sm },
  heroImage: { width: '100%', aspectRatio: 4 / 3, maxHeight: 340, maxWidth: (4 / 3) * 340, alignSelf: 'center', borderRadius: radius.xl },
});
