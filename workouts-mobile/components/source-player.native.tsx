import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Button, Copy, IconButton, Notice, useColors, useReducedMotion } from "@/components/ui";
import { containedPlayerSize, playerNavigationAllowed } from "@/lib/source-playback";
import type { SourcePlayerProps } from "./source-player";

export function SourcePlayerModal({ player, title, onClose, onOpenOriginal }: SourcePlayerProps) {
  const c = useColors(), insets = useSafeAreaInsets(), reduced = useReducedMotion();
  const [state, setState] = useState<"presenting" | "loading" | "loaded" | "error">("presenting");
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => { if (next !== "active") onClose(); });
    return () => sub.remove();
  }, [onClose]);
  useEffect(() => {
    if (state !== "loading") return;
    const timer = setTimeout(() => setState("error"), 15000);
    return () => clearTimeout(timer);
  }, [state, attempt]);
  const size = stage ? containedPlayerSize(stage.width, stage.height, player.aspectRatio) : null;
  return <Modal visible animationType={reduced ? "none" : "slide"} presentationStyle="fullScreen"
    onShow={() => setState("loading")} onRequestClose={onClose}>
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
        <Copy kind="subheading">{player.provider} player</Copy>
        <IconButton icon="close" label={`Close ${player.provider} player`} onPress={onClose} />
      </View>
      <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
        {(state === "presenting" || state === "loading") && <ActivityIndicator size="small" color={c.action} accessibilityLabel="Loading source player" />}
        <Copy kind="small" tone="muted" style={{ flex: 1 }}>{state === "error" ? "Player unavailable" : state === "loaded" ? "Use the player’s controls to start the video." : `Loading from ${player.provider}…`}</Copy>
      </View>
      <View testID="player-stage" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        onLayout={({ nativeEvent }) => setStage({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}>
        {state === "error" ? <ScrollView style={{ flex: 1, width: "100%", maxWidth: 460 }} contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: "center" }}>
          <Notice error>This player didn’t load. The post may be private, removed or unavailable. Try again or open the original source.</Notice>
          <Button title="Try player again" secondary onPress={() => { setAttempt(value => value + 1); setState("loading"); }} />
        </ScrollView> : state === "presenting" || !size ? null :
          <View testID="provider-player-region" style={size}>
            <WebView key={`${player.embedUrl}:${attempt}`} source={{ uri: player.embedUrl, headers: player.requestHeaders }}
              style={{ flex: 1, backgroundColor: c.background }}
              originWhitelist={["*"]} onShouldStartLoadWithRequest={({ url }) => playerNavigationAllowed(player, url)}
              setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} onOpenWindow={() => undefined}
              onLoadEnd={() => setState(value => value === "error" ? value : "loaded")}
              onError={() => setState("error")} onHttpError={({ nativeEvent }) => { if (nativeEvent.statusCode >= 400) setState("error"); }}
              onContentProcessDidTerminate={() => setState("error")} onRenderProcessGone={() => setState("error")}
              allowsInlineMediaPlayback allowsFullscreenVideo mediaPlaybackRequiresUserAction mixedContentMode="never"
              mediaCapturePermissionGrantType="deny" allowFileAccess={false}
              incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
              accessibilityLabel={`${player.provider} source player for ${title}`} />
          </View>}
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <Copy kind="small" numberOfLines={2}>{title}</Copy>
        <Copy kind="small" tone="muted">Player provided by {player.provider}. Its privacy terms apply.</Copy>
        <Button title="Open original source" secondary icon="open-outline" onPress={onOpenOriginal} />
      </View>
    </View>
  </Modal>;
}
