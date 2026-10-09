import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import type { SourceMediaKind, SourcePlayback } from '@/lib/sourcePlayback';
import { SourcePlaybackModal } from './SourcePlaybackModal';

type SourcePlaybackCardProps = {
  playback: SourcePlayback;
  recipeTitle: string;
  thumbnailUrl?: string | null;
  onThumbnailError?: () => void;
  onOpenSource: () => void | Promise<void>;
  embeddedPlaybackEnabled?: boolean;
  compact?: boolean;
};

const PROVIDER_ICONS = {
  youtube: 'logo-youtube',
  tiktok: 'logo-tiktok',
  instagram: 'logo-instagram',
} as const;

function mediaLabel(kind: SourceMediaKind): string {
  if (kind === 'photo') return 'photo post';
  return kind;
}

function previewAction(playback: SourcePlayback, opensExternally: boolean): string {
  if (opensExternally) {
    if (playback.mediaKind === 'post') return 'View original post on Instagram';
    if (playback.mediaKind === 'reel') return 'Watch original Reel on Instagram';
    if (playback.mediaKind === 'photo') {
      return `View original photo post on ${playback.providerLabel}`;
    }
    return `Watch original video on ${playback.providerLabel}`;
  }
  return playback.mediaKind === 'photo'
    ? 'View TikTok photo post'
    : `Play ${playback.providerLabel} video`;
}

/** An unobscured recipe photo with a wrapping source action; players load only on request. */
export function SourcePlaybackCard({
  playback,
  recipeTitle,
  thumbnailUrl,
  onThumbnailError,
  onOpenSource,
  embeddedPlaybackEnabled = true,
  compact = false,
}: SourcePlaybackCardProps) {
  const colors = useColors();
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const shouldOpenSource = useRef(false);
  const isExternal = playback.mode === 'external' || !embeddedPlaybackEnabled;
  const actionLabel = previewAction(playback, isExternal);
  const hasPhoto = !compact && Boolean(thumbnailUrl?.trim());
  const photoAspectRatio = playback.provider === 'youtube' ? 16 / 9 : 4 / 3;

  useEffect(() => {
    if (isPlayerVisible || !shouldOpenSource.current) return;
    shouldOpenSource.current = false;
    void onOpenSource();
  }, [isPlayerVisible, onOpenSource]);

  const handlePreviewPress = () => {
    if (isExternal) {
      void onOpenSource();
      return;
    }
    setIsPlayerVisible(true);
  };

  const handlePlayerOpenSource = () => {
    setIsPlayerVisible(false);
    shouldOpenSource.current = true;
  };

  return (
    <RNView style={[
      styles.card,
      { backgroundColor: colors.card, borderColor: colors.cardBorder },
      // Cap the whole card so its source row stays aligned with the proportional photo.
      hasPhoto && { maxWidth: photoAspectRatio * 340 + 2 },
    ]}>
      <TouchableOpacity
        style={styles.preview}
        onPress={handlePreviewPress}
        activeOpacity={0.9}
        accessibilityRole={isExternal ? 'link' : 'button'}
        accessibilityLabel={`${actionLabel} for ${recipeTitle}`}
        accessibilityHint={isExternal
          ? 'Opens the original source outside Håfa Recipes'
          : `Loading this player connects to ${playback.providerLabel}; its privacy terms apply`}
      >
        {hasPhoto && <RecipeThumbnail
          key={thumbnailUrl}
          uri={thumbnailUrl}
          style={[styles.previewImage, { aspectRatio: photoAspectRatio }]}
          accessible={false}
          priority="high"
          onError={onThumbnailError}
        />}
        <RNView style={styles.sourceAction}>
          <RNView style={[styles.providerIcon, { backgroundColor: `${colors.tint}15` }]}>
            <Ionicons name={PROVIDER_ICONS[playback.provider]} size={22} color={colors.actionText} />
          </RNView>
          <RNView style={styles.sourceCopy}>
            <Text style={[styles.footerTitle, { color: colors.text }]}>{playback.providerLabel} {mediaLabel(playback.mediaKind)}</Text>
            <Text style={[styles.sourceActionText, { color: colors.actionText }]}>{actionLabel}</Text>
          </RNView>
          <Ionicons name={isExternal ? 'open-outline' : playback.mediaKind === 'photo' ? 'images-outline' : 'play-circle-outline'}
            size={24} color={colors.actionText} />
        </RNView>
      </TouchableOpacity>

      {!isExternal && <RNView style={[styles.footer, { borderTopColor: colors.cardBorder }]}>
        <RNView >
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            Loading this player connects to {playback.providerLabel}; its privacy terms apply.
          </Text>
        </RNView>
        <TouchableOpacity
            onPress={() => { void onOpenSource(); }}
            style={styles.openButton}
            accessibilityRole="link"
            accessibilityLabel={`Open original recipe on ${playback.providerLabel}`}
          >
            <Text style={[styles.openButtonText, { color: colors.actionText }]}>Open {playback.providerLabel}</Text>
            <Ionicons name="open-outline" size={16} color={colors.actionText} />
        </TouchableOpacity>
      </RNView>}

      {playback.mode === 'modal' && embeddedPlaybackEnabled && isPlayerVisible && (
        <SourcePlaybackModal
          key={playback.embedUrl}
          visible
          playback={playback}
          recipeTitle={recipeTitle}
          onClose={() => setIsPlayerVisible(false)}
          onRequestOpenSource={handlePlayerOpenSource}
        />
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', alignSelf: 'center', borderWidth: 1, borderRadius: radius.xl, overflow: 'hidden' },
  preview: { width: '100%' },
  previewImage: { width: '100%', maxHeight: 340 },
  sourceAction: { minHeight: 80, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  providerIcon: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  sourceCopy: { flex: 1, minWidth: 0 },
  sourceActionText: { fontSize: fontSize.sm, marginTop: spacing.xs },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  footerTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.md },
  footerText: { fontSize: fontSize.xs, marginTop: 2 },
  openButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  openButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
