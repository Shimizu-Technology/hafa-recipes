import { useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { WebView } from 'react-native-webview';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import {
  getAutoplayEmbedUrl,
  isSourcePlaybackNavigationAllowed,
  type SourcePlayback,
} from '../lib/sourcePlayback';

type SourcePlaybackCardProps = {
  playback: SourcePlayback;
  recipeTitle: string;
  thumbnailUrl?: string | null;
  onThumbnailError?: () => void;
  onOpenSource: () => void;
};

const PROVIDER_ICONS = {
  youtube: 'logo-youtube',
  tiktok: 'logo-tiktok',
  instagram: 'logo-instagram',
} as const;

/** Lazily loads an official provider player inside the recipe detail screen. */
export function SourcePlaybackCard({
  playback,
  recipeTitle,
  thumbnailUrl,
  onThumbnailError,
  onOpenSource,
}: SourcePlaybackCardProps) {
  const colors = useColors();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const playerStyle = [
    styles.player,
    playback.aspectRatio < 1 && styles.portraitPlayer,
    { aspectRatio: playback.aspectRatio, backgroundColor: colors.backgroundSecondary },
  ];

  const handlePlay = () => {
    setHasPlaybackError(false);
    setIsPlayerLoading(true);
    setIsPlaying(true);
  };

  return (
    <RNView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <RNView style={styles.mediaStage}>
        {isPlaying && !hasPlaybackError ? (
          <RNView style={playerStyle}>
          <WebView
            source={{ uri: getAutoplayEmbedUrl(playback), headers: playback.requestHeaders }}
            style={styles.webView}
            // WebView opens schemes outside this list through the operating system before
            // calling our validator. Match every scheme here so the provider gate below is
            // always authoritative, including for instagram:// and other app deep links.
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={({ url }) => (
              isSourcePlaybackNavigationAllowed(playback.provider, url)
            )}
            // Android otherwise creates an unguarded native child WebView for target=_blank.
            // Popups are unnecessary here because the card provides its own source action.
            setSupportMultipleWindows={false}
            onOpenWindow={({ nativeEvent }) => {
              if (!isSourcePlaybackNavigationAllowed(playback.provider, nativeEvent.targetUrl)) {
                return;
              }
              // Provider-owned popup requests also remain closed so playback stays inline.
            }}
            onLoadProgress={({ nativeEvent }) => {
              if (nativeEvent.progress >= 0.8) setIsPlayerLoading(false);
            }}
            onLoadEnd={() => setIsPlayerLoading(false)}
            onError={() => {
              setIsPlayerLoading(false);
              setHasPlaybackError(true);
            }}
            onHttpError={({ nativeEvent }) => {
              if (nativeEvent.statusCode >= 400) {
                setIsPlayerLoading(false);
                setHasPlaybackError(true);
              }
            }}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            accessibilityLabel={`${playback.providerLabel} player for ${recipeTitle}`}
          />
          {isPlayerLoading && (
            <RNView
              pointerEvents="none"
              style={[styles.loading, { backgroundColor: colors.backgroundSecondary }]}
            >
              <ActivityIndicator color={colors.tint} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading {playback.providerLabel}…</Text>
            </RNView>
          )}
          </RNView>
        ) : (
          <TouchableOpacity
            style={playerStyle}
            onPress={handlePlay}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={hasPlaybackError
              ? `Retry ${playback.providerLabel} player for ${recipeTitle}`
              : `Play the ${playback.providerLabel} video for ${recipeTitle}`}
          >
            {thumbnailUrl ? (
              <ImageBackground
                source={{ uri: thumbnailUrl }}
                style={styles.previewImage}
                imageStyle={styles.previewImageRadius}
                resizeMode="cover"
                onError={onThumbnailError}
              >
                <RNView style={styles.previewScrim} />
              </ImageBackground>
            ) : (
              <RNView style={[styles.previewImage, { backgroundColor: colors.backgroundSecondary }]} />
            )}
            <RNView style={[styles.playButtonHalo, { backgroundColor: colors.card + 'D9' }]}>
              <RNView style={[styles.playButton, { backgroundColor: colors.tint }]}>
                <Ionicons name={hasPlaybackError ? 'refresh' : 'play'} size={28} color="#FFFFFF" />
              </RNView>
            </RNView>
            {hasPlaybackError && (
              <RNView style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Player unavailable</Text>
                <Text style={styles.errorText}>The post may be private, removed, or blocking embeds. Tap to retry.</Text>
              </RNView>
            )}
          </TouchableOpacity>
        )}

        <RNView style={styles.providerBadge} pointerEvents="none">
          <Ionicons name={PROVIDER_ICONS[playback.provider]} size={15} color="#FFFFFF" />
          <Text style={styles.providerBadgeText}>Original · {playback.providerLabel}</Text>
        </RNView>
      </RNView>

      <RNView style={styles.footer}>
        <RNView style={styles.footerCopy}>
          <Text style={[styles.footerTitle, { color: colors.text }]}>Watch the original</Text>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>Playback stays with the creator.</Text>
        </RNView>
        <TouchableOpacity
          onPress={onOpenSource}
          style={styles.openButton}
          accessibilityRole="link"
          accessibilityLabel={`Open original recipe on ${playback.providerLabel}`}
        >
          <Text style={[styles.openButtonText, { color: colors.tint }]}>Open original</Text>
          <Ionicons name="open-outline" size={16} color={colors.tint} />
        </TouchableOpacity>
      </RNView>
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
  mediaStage: {
    position: 'relative',
    alignItems: 'center',
    backgroundColor: '#12100E',
  },
  player: {
    width: '100%',
    minHeight: 210,
    position: 'relative',
    overflow: 'hidden',
  },
  portraitPlayer: {
    width: '78%',
    maxWidth: 390,
  },
  webView: { flex: 1, backgroundColor: 'transparent' },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: { fontSize: fontSize.sm },
  previewImage: { ...StyleSheet.absoluteFill },
  previewImageRadius: { borderRadius: 0 },
  previewScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 12, 8, 0.28)',
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
  },
  playButtonHalo: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    width: 80,
    height: 80,
    marginTop: -40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  errorCopy: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    alignItems: 'center',
    backgroundColor: 'rgba(20, 12, 8, 0.82)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  errorTitle: { color: '#FFFFFF', fontWeight: fontWeight.bold, fontSize: fontSize.md },
  errorText: { color: '#FFFFFF', fontSize: fontSize.sm, textAlign: 'center', marginTop: 2 },
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
