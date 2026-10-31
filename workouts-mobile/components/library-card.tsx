import { GlassView } from "expo-glass-effect";
import { largeText, workoutGridWidth } from "@/lib/readable-layout";
import { useState } from "react";
import { Animated, Pressable, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { motion, radii, spacing } from "@/constants/theme";
import { Copy, useColors, useReducedMotion, type IconName } from "@/components/ui";
import { animatedPressableComponent, usePressScale } from "@/components/design/press";
import type { LibraryView } from "@/lib/library-view";

export const LIBRARY_GRID_GAP = 12;

/** Width of one grid column inside the screen's content padding. */
export function useLibraryGridWidth() {
  const { width, fontScale } = useWindowDimensions();
  return workoutGridWidth(width, fontScale);
}

function Cover({ uri, icon, size }: { uri?: string | null; icon: IconName; size: number }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState<string | null>(null);
  if (uri && uri !== failed)
    return <Image source={{ uri }} onError={() => setFailed(uri)} contentFit="cover" transition={reduced ? 0 : motion.base}
      style={{ width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.actionSoft }}>
    <Ionicons name={icon} size={size} color={c.onActionSoft} />
  </View>;
}

/** Small round mark over a cover: the favorite heart or the selection checkbox. */
function Mark({ kind }: { kind: "favorite" | "selected" | "unselected" }) {
  const c = useColors();
  const selected = kind === "selected";
  return <View style={{
    width: 28, height: 28, borderRadius: radii.full, alignItems: "center", justifyContent: "center",
    backgroundColor: selected ? c.action : c.imageOverlay, borderWidth: kind === "unselected" ? 1.5 : 0, borderColor: c.onImage,
  }}>
    {kind !== "unselected" && <Ionicons name={selected ? "checkmark" : "heart"} size={16} color={selected ? c.onAction : c.onImage} />}
  </View>;
}

export function LibraryCard({
  view, title, meta, creator, origin, image, icon, favorite, badge, selected, onPress, onLongPress, save, fill,
}: {
  fill?: boolean;
  save?: { saved: boolean; busy: boolean; onPress(): void };
  view: LibraryView;
  title: string;
  meta: string;
  /** Original source credit, kept in both grid and list views. */
  creator?: string | null;
  origin?: string;
  image?: string | null;
  icon: IconName;
  favorite: boolean;
  /** Quiet neutral note, e.g. "Check details". */
  badge?: string;
  /** Defined while the library is selecting. */
  selected?: boolean;
  onPress(): void;
  onLongPress?(): void;
}) {
  const c = useColors();
  const press = usePressScale();
  const width = useLibraryGridWidth();
  const { fontScale } = useWindowDimensions();
  const AnimatedPressable = animatedPressableComponent();
  const grid = view === "grid";
  const selecting = selected !== undefined;
  const corner = selecting ? <Mark kind={selected ? "selected" : "unselected"} /> : null;
  return (
    <AnimatedPressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={[title, meta, creator ? `By ${creator}` : null, origin, favorite ? "Favorite" : null, badge].filter(Boolean).join(", ")}
      accessibilityHint={onLongPress ? "Long press to select workouts" : undefined}
      accessibilityState={selecting ? { checked: selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{
        width: grid && !fill ? width : "100%",
        flexDirection: grid ? "column" : "row",
        alignItems: grid ? "stretch" : "center",
        gap: grid ? 0 : spacing.sm,
        padding: grid ? 0 : spacing.xs,
        borderRadius: radii.lg - 4,
        overflow: "hidden",
        backgroundColor: "transparent",
        borderWidth: selected ? 2 : 0,
        borderColor: selected ? c.action : c.border,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      <View style={grid ? { width: "100%", aspectRatio: 4 / 5, borderRadius: 14, overflow: "hidden" } : { width: 72, height: 72, borderRadius: radii.md - 4, overflow: "hidden" }}>
        <Cover uri={image} icon={icon} size={grid ? 36 : 26} />
        {!!meta && <GlassView glassEffectStyle="clear" tintColor={c.imageOverlay} style={{ position: "absolute", left: 8, bottom: 8, borderRadius: radii.full, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.imageOverlay }}>
          <Copy kind="caption2" color={c.onImage}>{meta}</Copy>
        </GlassView>}
        {save && <Pressable accessibilityRole="button" accessibilityLabel={save.saved ? "Saved to your library" : `Save ${title}`} accessibilityState={{ disabled: save.busy || save.saved, selected: save.saved }} disabled={save.busy || save.saved}
          onPress={event => { event.stopPropagation(); save.onPress(); }} hitSlop={7} style={{ position: "absolute", right: 7, top: 7, width: 30, height: 30, borderRadius: 15, backgroundColor: c.imageOverlay, alignItems: "center", justifyContent: "center" }}>
          <GlassView pointerEvents="none" glassEffectStyle="clear" tintColor={c.imageOverlay} style={{ position: "absolute", inset: 0, borderRadius: 15 }} />
          <Ionicons name={save.saved ? "bookmark" : "bookmark-outline"} size={17} color={c.onImage} />
        </Pressable>}
        {!!corner && <View style={{ position: "absolute", top: grid ? 8 : 4, right: grid ? 8 : 4 }}>{corner}</View>}
      </View>
      <View style={{ flex: grid ? undefined : 1, minWidth: 0, gap: 2, paddingTop: grid ? 8 : 0 }}>
        <Copy kind="cardTitle" numberOfLines={largeText(fontScale) ? undefined : 2}>{title}</Copy>
        <Copy kind="caption" tone="muted" numberOfLines={largeText(fontScale) ? undefined : 1}>{[creator, origin?.replace(/^Saved from /, "")].filter(Boolean).join(" · ") || "Your workout"}</Copy>
      </View>
    </AnimatedPressable>
  );
}

/** Horizontal tiles for collections: a 2×2 mosaic with four covers, else one cover or a folder. */
export function CollectionTile({ title, count, covers, onPress }: {
  title: string; count: number; covers: string[]; onPress(): void;
}) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  const { width, fontScale } = useWindowDimensions();
  const tileWidth = largeText(fontScale) ? workoutGridWidth(width, fontScale) : 128;
  const mosaic = covers.length >= 4;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count} ${count === 1 ? "workout" : "workouts"}`}
      accessibilityHint="Opens this collection"
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{ width: tileWidth, gap: 6, opacity: press.opacity, transform: [{ scale: press.scale }] }}
    >
      <View style={{ width: tileWidth, height: largeText(fontScale) ? 160 : 88, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: c.border,
        flexDirection: "row", flexWrap: "wrap", gap: 1, backgroundColor: c.border }}>
        {mosaic ? covers.slice(0, 4).map((uri, index) => <View key={index} style={{ width: (tileWidth - 3) / 2, height: largeText(fontScale) ? 78.5 : 42.5 }}>
          <Cover uri={uri} icon="image-outline" size={18} />
        </View>) : <Cover uri={covers[0]} icon="folder-open-outline" size={28} />}
      </View>
      <View>
        <Copy kind="label" numberOfLines={largeText(fontScale) ? undefined : 1}>{title}</Copy>
        <Copy kind="small" tone="muted">{count} {count === 1 ? "workout" : "workouts"}</Copy>
      </View>
    </AnimatedPressable>
  );
}
