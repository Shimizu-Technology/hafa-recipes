import { useCallback, useState } from "react";
import { Linking, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { Button, Copy, Notice } from "@/components/ui";
import { embeddedSourcesEnabled, sourcePlayer, sourceURL } from "@/lib/source-playback";
import { SourcePlayerModal } from "./source-player";

export function hasSourcePlayback(url: string | null | undefined, showOriginal: boolean) {
  const source = sourceURL(url);
  return !!source && (showOriginal || (Platform.OS !== "web" && embeddedSourcesEnabled() && !!sourcePlayer(source.href)));
}

export function SourcePlayback({ url, title, showOriginal = true }: { url?: string | null; title: string; showOriginal?: boolean }) {
  const [requested, setRequested] = useState<string | null>(null), [error, setError] = useState("");
  const close = useCallback(() => setRequested(null), []);
  useFocusEffect(useCallback(() => close, [close]));
  const source = sourceURL(url);
  if (!source) return null;
  const player = sourcePlayer(source.href);
  const embedded = !!player && Platform.OS !== "web" && embeddedSourcesEnabled();
  const openOriginal = () => {
    close();
    setError("");
    void Linking.openURL(source.href).catch(() => setError("Could not open the original source. Check your connection and try again."));
  };
  return <>
    {embedded && <>
      <Button title={`Watch ${player.provider} source`} secondary icon="play-circle-outline" onPress={() => { setError(""); setRequested(source.href); }}
        accessibilityHint={`Loads the official ${player.provider} player. Its privacy terms apply. Playback starts only when you press play.`} />
      <Copy kind="small" tone="muted">Loading the player connects to {player.provider}; its privacy terms apply.</Copy>
    </>}
    {showOriginal && <Button title="Open original source" secondary icon="open-outline" onPress={openOriginal} />}
    {!!error && <Notice error>{error}</Notice>}
    {requested === source.href && embedded && <SourcePlayerModal key={player.embedUrl} player={player} title={title} onClose={close} onOpenOriginal={openOriginal} />}
  </>;
}
