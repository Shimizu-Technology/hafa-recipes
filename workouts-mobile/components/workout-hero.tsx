import { useCallback, useState } from "react";
import { Image, Linking, Platform, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { Button, Copy, Notice, Row, useColors } from "@/components/ui";
import { animatedPressableComponent, usePressScale } from "@/components/design/press";
import { SourceImage } from "@/components/source-image";
import { embeddedSourcesEnabled, sourcePlayer, sourceURL } from "@/lib/source-playback";
import type { Workout } from "@/lib/models";
import { radii } from "@/constants/theme";
import { SourcePlayerModal } from "./source-player";

type Source = Pick<Workout, "title" | "source_title" | "source_creator" | "source_thumbnail_url" | "source_url" | "cover_origin">;

/**
 * The workout's photo or video, first and full width. When the source is a video,
 * the play button really plays it: the official player in the app, or the original
 * post when in-app playback isn't available. Other covers enlarge on tap.
 */
export function WorkoutHero({ source }: { source: Source }) {
  const c = useColors();
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState<string | null>(null), [error, setError] = useState("");
  const press = usePressScale();
  const close = useCallback(() => setPlaying(false), []);
  useFocusEffect(useCallback(() => close, [close]));
  const url = sourceURL(source.source_url);
  const player = url ? sourcePlayer(url.href) : null;
  const embedded = !!player && Platform.OS !== "web" && embeddedSourcesEnabled();
  const image = source.source_thumbnail_url && failed !== source.source_thumbnail_url ? source.source_thumbnail_url : null;
  const label = source.cover_origin === "user" ? "Custom workout cover photo" : source.source_title ?? "Original workout source";
  const credit = source.source_creator ? `Original by ${source.source_creator}` : source.source_title;
  const openOriginal = () => {
    close();
    setError("");
    if (url) void Linking.openURL(url.href).catch(() => setError("Could not open the original source. Check your connection and try again."));
  };
  if (!image && !player && !credit && !url) return null;
  const Pressable = animatedPressableComponent();
  return <View style={{ gap: 10 }}>
    {player ? <Pressable
      accessibilityRole="button"
      accessibilityLabel={embedded ? `Play ${player.provider} video for ${source.title}` : `Open ${player.provider} video for ${source.title}`}
      accessibilityHint={embedded ? `Loads the official ${player.provider} player. Its privacy terms apply.` : "Opens the original post"}
      onPress={() => { setError(""); if (embedded) setPlaying(true); else openOriginal(); }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{ borderRadius: radii.lg, overflow: "hidden", backgroundColor: c.sunken, opacity: press.opacity, transform: [{ scale: press.scale }] }}
    >
      {image
        ? <Image source={{ uri: image }} accessibilityIgnoresInvertColors onError={() => setFailed(image)}
          style={{ width: "100%", aspectRatio: 4 / 3, maxHeight: 360, resizeMode: "cover" }} />
        : <View style={{ width: "100%", aspectRatio: 16 / 9 }} />}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 64, height: 64, borderRadius: radii.full, backgroundColor: c.imageOverlay, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="play" size={30} color={c.onImage} style={{ marginLeft: 4 }} />
        </View>
      </View>
    </Pressable> : image ? <View style={{ borderRadius: radii.lg, overflow: "hidden" }}>
      <SourceImage uri={image} cover label={label} fallback={null} />
    </View> : null}
    {(!!credit || !!url) && <Row gap={8}>
      {!!credit && <Copy kind="small" tone="muted" numberOfLines={2} style={{ flex: 1 }}>{credit}</Copy>}
      {!!url && <Button title="Open original source" icon="open-outline" variant="ghost" size="sm" inline onPress={openOriginal} />}
    </Row>}
    {embedded && <Copy kind="small" tone="muted">Playing loads the {player!.provider} player; its privacy terms apply.</Copy>}
    {!!error && <Notice error>{error}</Notice>}
    {playing && embedded && player && <SourcePlayerModal key={player.embedUrl} player={player} title={source.source_title ?? source.title}
      onClose={close} onOpenOriginal={openOriginal} />}
  </View>;
}
