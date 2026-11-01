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
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />;
  // A quiet tonal tile, not a coral slab: the title below carries the card.
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}>
    <Ionicons name={icon} size={size} color={c.tertiaryLabel} />
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
    <View style={{ width: grid && !fill ? width : "100%" }}>
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
        width: "100%",
        flexDirection: grid ? "column" : "row",
        alignItems: grid ? "stretch" : "center",
        gap: grid ? 0 : spacing.sm,
        padding: grid ? 0 : spacing.xs,
        borderRadius: radii.lg - 4,
        backgroundColor: "transparent",
        borderWidth: selected ? 2 : 0,
        borderColor: selected ? c.action : c.border,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      <View style={grid ? { width: "100%", aspectRatio: 4 / 5, borderRadius: 14, overflow: "hidden" } : { width: 72, height: 72, borderRadius: radii.md - 4, overflow: "hidden" }}>
        <Cover uri={image} icon={icon} size={grid ? 28 : 24} />
        {grid && !!meta && <View style={{ position: "absolute", left: 8, bottom: 8, borderRadius: radii.full, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.imageOverlay }}>
          <Copy kind="caption2" color={c.onImage}>{meta}</Copy>
        </View>}

        {!!corner && <View style={{ position: "absolute", top: grid ? 8 : 4, right: grid ? 8 : 4 }}>{corner}</View>}
      </View>
      <View style={{ flex: grid ? undefined : 1, minWidth: 0, gap: 2, paddingTop: grid ? 8 : 0 }}>
        <Copy kind="cardTitle" numberOfLines={largeText(fontScale) ? undefined : 2} style={grid && !largeText(fontScale) ? { minHeight: Math.ceil(40 * fontScale) } : undefined}>{title}</Copy>
        {!grid && !!meta && <Copy kind="caption" tone="muted">{meta}</Copy>}
        <Copy kind="caption" tone="muted" numberOfLines={largeText(fontScale) ? undefined : 1}>{[creator, origin?.replace(/^Saved from /, "")].filter(Boolean).join(" · ") || "Your workout"}</Copy>
      </View>
    </AnimatedPressable>
        {save && <Pressable accessibilityRole="button" accessibilityLabel={save.saved ? "Saved to your library" : `Save ${title}`} accessibilityState={{ disabled: save.busy || save.saved, selected: save.saved }} disabled={save.busy || save.saved}
          onPress={event => { event.stopPropagation(); save.onPress(); }} hitSlop={7} style={{ position: "absolute", right: 7, top: 7, width: 30, height: 30, borderRadius: 15, backgroundColor: c.imageOverlay, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={save.saved ? "bookmark" : "bookmark-outline"} size={17} color={c.onImage} />
        </Pressable>}
    </View>
  );
}

/**
 * Collection card (spec v2 §1.5): one wide cover over two half covers, 1pt gaps, radius 16.
 * One cover fills the card; none shows a tonal tile with a folder.
 */
export function CollectionCard({ title, count, covers, onPress, width }: {
  title: string; count: number; covers: string[]; onPress(): void; width: number;
}) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  const { fontScale } = useWindowDimensions();
  const height = Math.round(width * 0.8);
  const top = Math.round(height * 0.6);
  return (
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={`${title}, ${count} ${count === 1 ? "workout" : "workouts"}`}
      accessibilityHint="Opens this collection" onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
      style={{ width, gap: 8, opacity: press.opacity, transform: [{ scale: press.scale }] }}>
      <View style={{ width, height, borderRadius: 16, overflow: "hidden", gap: 1, backgroundColor: c.background }}>
        {covers.length >= 3 ? <>
          <View style={{ height: top }}><Cover uri={covers[0]} icon="image-outline" size={22} /></View>
          <View style={{ flex: 1, flexDirection: "row", gap: 1 }}>
            <View style={{ flex: 1 }}><Cover uri={covers[1]} icon="image-outline" size={18} /></View>
            <View style={{ flex: 1 }}><Cover uri={covers[2]} icon="image-outline" size={18} /></View>
          </View>
        </> : <Cover uri={covers[0]} icon="folder-open-outline" size={30} />}
      </View>
      <View style={{ gap: 2 }}>
        <Copy numberOfLines={largeText(fontScale) ? undefined : 1} style={{ fontSize: 16, lineHeight: 21, fontWeight: "600" }}>{title}</Copy>
        <Copy kind="caption" tone="muted">{count} {count === 1 ? "workout" : "workouts"}</Copy>
      </View>
    </AnimatedPressable>
  );
}

/** First tile in the collections grid: a dashed outline that starts a new collection. */
export function NewCollectionCard({ width, onPress }: { width: number; onPress(): void }) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  return (
    <AnimatedPressable accessibilityRole="button" accessibilityLabel="New collection" onPress={onPress}
      onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={{ width, gap: 8, opacity: press.opacity, transform: [{ scale: press.scale }] }}>
      <View style={{ width, height: Math.round(width * 0.8), borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.borderStrong,
        alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Ionicons name="add" size={28} color={c.accentText} />
      </View>
      <Copy style={{ fontSize: 16, lineHeight: 21, fontWeight: "600" }}>New collection</Copy>
    </AnimatedPressable>
  );
}
