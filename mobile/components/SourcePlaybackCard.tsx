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

/** Compact source preview that opens a focused player or the original post. */
export function SourcePlaybackCard({
  playback,
  recipeTitle,
  thumbnailUrl,
  onThumbnailError,
  onOpenSource,
  embeddedPlaybackEnabled = true,
}: SourcePlaybackCardProps) {
  const colors = useColors();
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const shouldOpenSource = useRef(false);
  const isExternal = playback.mode === 'external' || !embeddedPlaybackEnabled;
  const actionLabel = previewAction(playback, isExternal);

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
    <RNView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
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
        <RecipeThumbnail
          uri={thumbnailUrl}
          style={styles.previewImage}
          accessible={false}
          placeholderIconSize={56}
          priority="high"
          onError={onThumbnailError}
        />
        <RNView pointerEvents="none" style={styles.previewScrim} />
        <RNView style={styles.providerBadge} pointerEvents="none">
          <Ionicons name={PROVIDER_ICONS[playback.provider]} size={15} color="#FFFFFF" />
          <Text style={styles.providerBadgeText}>
            {playback.providerLabel} {mediaLabel(playback.mediaKind)}
          </Text>
        </RNView>
        <RNView style={styles.previewAction} pointerEvents="none">
          <RNView style={[styles.actionIcon, { backgroundColor: colors.tint }]}>
            <Ionicons
              name={isExternal
                ? 'open-outline'
                : playback.mediaKind === 'photo'
                  ? 'images-outline'
                  : 'play'}
              size={27}
              color="#FFFFFF"
            />
          </RNView>
          <Text style={styles.previewActionText}>{actionLabel}</Text>
        </RNView>
      </TouchableOpacity>

      <RNView style={styles.footer}>
        <RNView style={styles.footerCopy}>
          <Text style={[styles.footerTitle, { color: colors.text }]}>
            {isExternal
              ? 'Continue with the creator'
              : `Watch here or on ${playback.providerLabel}`}
          </Text>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            {isExternal
              ? `${playback.providerLabel} opens in its app or website.`
              : `Loading this player connects to ${playback.providerLabel}; its privacy terms apply.`}
          </Text>
        </RNView>
        {!isExternal && (
          <TouchableOpacity
            onPress={() => { void onOpenSource(); }}
            style={styles.openButton}
            accessibilityRole="link"
            accessibilityLabel={`Open original recipe on ${playback.providerLabel}`}
          >
            <Text style={[styles.openButtonText, { color: colors.tint }]}>Open {playback.providerLabel}</Text>
            <Ionicons name="open-outline" size={16} color={colors.tint} />
          </TouchableOpacity>
        )}
      </RNView>

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
  card: {
    borderWidth: 1,
    overflow: 'hidden',
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  preview: {
    aspectRatio: 16 / 9,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#12100E',
  },
  previewImage: { ...StyleSheet.absoluteFill },
  previewScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 12, 8, 0.34)',
  },
  providerBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(20, 12, 8, 0.78)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  providerBadgeText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.2,
    textTransform: 'capitalize',
  },
  previewAction: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionIcon: {
    width: 62,
    height: 62,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  previewActionText: {
    color: '#FFFFFF',
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerCopy: { flex: 1 },
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
