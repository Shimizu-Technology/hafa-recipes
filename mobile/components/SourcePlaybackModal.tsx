import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
  type LayoutChangeEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import {
  getAutoplayEmbedUrl,
  isSourcePlaybackNavigationAllowed,
  type ModalSourcePlayback,
} from '@/lib/sourcePlayback';

type SourcePlaybackModalProps = {
  visible: boolean;
  playback: ModalSourcePlayback;
  recipeTitle: string;
  onClose: () => void;
  onRequestOpenSource: () => void;
};

type LoadState = 'presenting' | 'loading' | 'loaded' | 'error';

export const SOURCE_PLAYER_LOAD_TIMEOUT_MS = 15_000;

/** Fit a provider viewport within both the available width and height. */
export function containedPlayerSize(
  availableWidth: number,
  availableHeight: number,
  aspectRatio: number,
): { width: number; height: number } {
  const boundedWidth = Math.max(0, availableWidth);
  const boundedHeight = Math.max(0, availableHeight);
  const width = Math.min(boundedWidth, boundedHeight * aspectRatio);
  const naturalHeight = width / aspectRatio;
  return {
    width,
    height: Math.min(
      boundedHeight,
      boundedWidth >= 200 && boundedHeight >= 200
        ? Math.max(200, naturalHeight)
        : naturalHeight,
    ),
  };
}

/** Provider-owned playback with every Håfa control outside the player rectangle. */
export function SourcePlaybackModal({
  visible,
  playback,
  recipeTitle,
  onClose,
  onRequestOpenSource,
}: SourcePlaybackModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [loadState, setLoadState] = useState<LoadState>('presenting');
  const [attempt, setAttempt] = useState(0);
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') onClose();
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  useEffect(() => {
    if (loadState !== 'loading') return;
    const timeout = setTimeout(() => setLoadState('error'), SOURCE_PLAYER_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [attempt, loadState]);

  const playerSize = useMemo(() => (
    stageSize
      ? containedPlayerSize(stageSize.width, stageSize.height, playback.aspectRatio)
      : null
  ), [playback.aspectRatio, stageSize]);

  const handleStageLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout;
    setStageSize((current) => (
      current?.width === width && current.height === height ? current : { width, height }
    ));
  };

  const retry = () => {
    setAttempt((value) => value + 1);
    setLoadState('loading');
  };

  const isLoading = loadState === 'presenting' || loadState === 'loading';
  const hasError = loadState === 'error';
  const mediaLabel = playback.mediaKind === 'photo' ? 'photo post' : 'video';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onShow={() => setLoadState('loading')}
      onRequestClose={onClose}
    >
      <RNView
        style={[styles.modal, { backgroundColor: colors.background }]}
        accessibilityViewIsModal
      >
        <RNView
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm },
          ]}
        >
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={`Close ${playback.providerLabel} player`}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <RNView style={styles.headerCopy}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={2}>
              {playback.providerLabel} {mediaLabel}
            </Text>
            <RNView style={styles.status} accessibilityLiveRegion="polite">
              {isLoading && (
                <ActivityIndicator
                  size="small"
                  color={colors.tint}
                  accessibilityLabel={`Loading ${playback.providerLabel} player`}
                />
              )}
              <Text style={[styles.statusText, { color: colors.textMuted }]} numberOfLines={1}>
                {hasError
                  ? 'Player unavailable'
                  : isLoading
                    ? `Loading from ${playback.providerLabel}…`
                    : `Loaded from ${playback.providerLabel}`}
              </Text>
            </RNView>
          </RNView>
          <RNView style={styles.headerButton} />
        </RNView>

        <RNView style={styles.playerStage} testID="player-stage" onLayout={handleStageLayout}>
          {hasError ? (
            <RNView
              style={[styles.errorPanel, { backgroundColor: colors.backgroundSecondary }]}
            >
              <RNView style={styles.errorMessage} accessible accessibilityRole="alert">
                <RNView style={[styles.errorIcon, { backgroundColor: `${colors.tint}18` }]}>
                  <Ionicons name="videocam-off-outline" size={30} color={colors.tint} />
                </RNView>
                <Text style={[styles.errorTitle, { color: colors.text }]}>This player didn’t load</Text>
                <Text style={[styles.errorText, { color: colors.textSecondary }]}>
                  The post may be private, removed, or temporarily unavailable. You can try again or use
                  the original source below.
                </Text>
              </RNView>
              <RNView style={styles.errorActions}>
                <TouchableOpacity
                  onPress={retry}
                  style={[styles.primaryButton, { backgroundColor: colors.tint }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Try loading the ${playback.providerLabel} player again`}
                >
                  <Ionicons name="refresh" size={19} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Try again</Text>
                </TouchableOpacity>
              </RNView>
            </RNView>
          ) : loadState === 'presenting' || !playerSize ? null : (
            <RNView style={[styles.player, playerSize]} testID="provider-player-region">
              <WebView
                key={`${playback.embedUrl}:${attempt}`}
                source={{ uri: getAutoplayEmbedUrl(playback), headers: playback.requestHeaders }}
                style={styles.webView}
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={({ url }) => (
                  isSourcePlaybackNavigationAllowed(playback, url)
                )}
                setSupportMultipleWindows={false}
                onOpenWindow={({ nativeEvent }) => {
                  if (!isSourcePlaybackNavigationAllowed(playback, nativeEvent.targetUrl)) return;
                  // Even provider-owned popups remain closed; the footer is the intentional exit.
                }}
                onLoadEnd={() => setLoadState((state) => (
                  state === 'error' ? state : 'loaded'
                ))}
                onError={() => setLoadState('error')}
                onHttpError={({ nativeEvent }) => {
                  if (nativeEvent.statusCode >= 400) setLoadState('error');
                }}
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                mediaPlaybackRequiresUserAction={false}
                mixedContentMode="never"
                accessibilityLabel={`${playback.providerLabel} ${mediaLabel} player for ${recipeTitle}`}
              />
            </RNView>
          )}
        </RNView>

        <RNView
          style={[
            styles.footer,
            { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <RNView style={styles.footerCopy}>
            <Text style={[styles.footerTitle, { color: colors.text }]} numberOfLines={2}>
              {recipeTitle}
            </Text>
            <Text style={[styles.footerText, { color: colors.textMuted }]}>
              Player provided by {playback.providerLabel}. Its privacy terms apply.
            </Text>
          </RNView>
          <TouchableOpacity
            onPress={onRequestOpenSource}
            style={[styles.openButton, { borderColor: colors.border }]}
            accessibilityRole="link"
            accessibilityLabel={`Open original on ${playback.providerLabel}`}
          >
            <Text style={[styles.openButtonText, { color: colors.tint }]}>Open original</Text>
            <Ionicons name="open-outline" size={17} color={colors.tint} />
          </TouchableOpacity>
        </RNView>
      </RNView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: {
    minHeight: 82,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.md },
  status: {
    minHeight: 22,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusText: { fontSize: fontSize.xs },
  playerStage: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  player: { overflow: 'hidden', backgroundColor: '#0D0D0D' },
  webView: { flex: 1, backgroundColor: '#0D0D0D' },
  errorPanel: {
    width: '86%',
    maxWidth: 420,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  errorMessage: { width: '100%', alignItems: 'center' },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  errorTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.lg },
  errorText: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorActions: { width: '100%', marginTop: spacing.lg, gap: spacing.sm },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: { color: '#FFFFFF', fontFamily: fontFamily.semibold, fontSize: fontSize.md },
  footer: {
    minHeight: 92,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerCopy: { flex: 1 },
  footerTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  footerText: { fontSize: fontSize.xs, marginTop: 2 },
  openButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  openButtonText: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
});
