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
  isSourcePlaybackNavigationAllowed,
  type SourcePlayback,
} from '../lib/sourcePlayback';

type SourcePlaybackCardProps = {
  playback: SourcePlayback;
  recipeTitle: string;
  thumbnailUrl?: string | null;
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
  onOpenSource,
}: SourcePlaybackCardProps) {
  const colors = useColors();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const playerStyle = [
    styles.player,
    { aspectRatio: playback.aspectRatio, backgroundColor: colors.backgroundSecondary },
  ];

  const handlePlay = () => {
    setHasPlaybackError(false);
    setIsPlayerLoading(true);
    setIsPlaying(true);
  };

  return (
    <RNView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <RNView style={styles.headingRow}>
        <RNView style={[styles.providerIcon, { backgroundColor: colors.tint + '16' }]}>
          <Ionicons name={PROVIDER_ICONS[playback.provider]} size={20} color={colors.tint} />
        </RNView>
        <RNView style={styles.headingCopy}>
          <Text style={[styles.eyebrow, { color: colors.tint }]}>ORIGINAL RECIPE</Text>
          <Text style={[styles.heading, { color: colors.text }]}>Watch on {playback.providerLabel}</Text>
        </RNView>
      </RNView>

      {isPlaying && !hasPlaybackError ? (
        <RNView style={playerStyle}>
          <WebView
            source={{ uri: playback.embedUrl, headers: playback.requestHeaders }}
            style={styles.webView}
            // Let the callback reject off-provider destinations before WebView can hand them
            // to the operating system (for example, an embedded Instagram App Store link).
            originWhitelist={['https://*', 'about:blank']}
            onShouldStartLoadWithRequest={({ url }) => (
              isSourcePlaybackNavigationAllowed(playback.provider, url)
            )}
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
            mediaPlaybackRequiresUserAction
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
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={hasPlaybackError
            ? `Retry ${playback.providerLabel} player for ${recipeTitle}`
            : `Open the ${playback.providerLabel} player for ${recipeTitle} in Håfa Recipes`}
        >
          {thumbnailUrl ? (
            <ImageBackground
              source={{ uri: thumbnailUrl }}
              style={styles.previewImage}
              imageStyle={styles.previewImageRadius}
              resizeMode="cover"
            >
              <RNView style={styles.previewScrim} />
            </ImageBackground>
          ) : (
            <RNView style={[styles.previewImage, { backgroundColor: colors.backgroundSecondary }]} />
          )}
          <RNView style={[styles.playButton, { backgroundColor: colors.tint }]}>
            <Ionicons name={hasPlaybackError ? 'refresh' : 'play'} size={30} color="#FFFFFF" />
          </RNView>
          {hasPlaybackError && (
            <RNView style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Player unavailable</Text>
              <Text style={styles.errorText}>The post may be private, removed, or blocking embeds. Tap to retry.</Text>
            </RNView>
          )}
        </TouchableOpacity>
      )}

      <RNView style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textMuted }]}>Playback stays with the original creator.</Text>
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
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  providerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { flex: 1 },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.7,
  },
  heading: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.lg,
    marginTop: 2,
  },
  player: {
    width: '100%',
    minHeight: 210,
    maxHeight: 580,
    position: 'relative',
    overflow: 'hidden',
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
    backgroundColor: 'rgba(20, 12, 8, 0.38)',
  },
  playButton: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    width: 68,
    height: 68,
    marginTop: -34,
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
  },
  errorTitle: { color: '#FFFFFF', fontWeight: fontWeight.bold, fontSize: fontSize.md },
  errorText: { color: '#FFFFFF', fontSize: fontSize.sm, textAlign: 'center', marginTop: 2 },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerText: { flex: 1, fontSize: fontSize.xs },
  openButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  openButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
