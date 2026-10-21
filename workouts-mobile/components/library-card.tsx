import { useState } from "react";
import { Animated, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { contentWidth, motion, radii, spacing } from "@/constants/theme";
import { Copy, useColors, useReducedMotion, type IconName } from "@/components/ui";
import { animatedPressableComponent, usePressScale } from "@/components/design/press";
import type { LibraryView } from "@/lib/library-view";

export const LIBRARY_GRID_GAP = spacing.sm;

/** Width of one grid column inside the screen's content padding. */
export function useLibraryGridWidth() {
  const { width } = useWindowDimensions();
  return Math.floor((Math.min(width, contentWidth) - (spacing.lg - 4) * 2 - LIBRARY_GRID_GAP) / 2);
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
    backgroundColor: selected ? c.action : c.overlay, borderWidth: kind === "unselected" ? 1.5 : 0, borderColor: c.onHero,
  }}>
    {kind !== "unselected" && <Ionicons name={selected ? "checkmark" : "heart"} size={16} color={selected ? c.onAction : c.onHero} />}
  </View>;
}

export function LibraryCard({
  view, title, meta, creator, image, icon, favorite, badge, selected, onPress, onLongPress,
}: {
  view: LibraryView;
  title: string;
  meta: string;
  /** Source credit; shown in the list view. */
  creator?: string | null;
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
  const corner = selecting ? <Mark kind={selected ? "selected" : "unselected"} /> : favorite ? <Mark kind="favorite" /> : null;
  const note = !!badge && <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full, backgroundColor: c.sunken }}>
    <Copy kind="caption" tone="muted">{badge}</Copy>
  </View>;
  return (
    <AnimatedPressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={[title, meta, creator ? `By ${creator}` : null, favorite ? "Favorite" : null, badge].filter(Boolean).join(", ")}
      accessibilityHint={onLongPress ? "Long press to select workouts" : undefined}
      accessibilityState={selecting ? { checked: selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{
        width: grid ? width : "100%",
        flexDirection: grid ? "column" : "row",
        alignItems: grid ? "stretch" : "center",
        gap: grid ? 0 : spacing.sm,
        padding: grid ? 0 : spacing.xs,
        borderRadius: radii.lg - 4,
        overflow: "hidden",
        backgroundColor: c.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.action : c.border,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      <View style={grid ? { width: "100%", aspectRatio: 1 } : { width: 72, height: 72, borderRadius: radii.md - 4, overflow: "hidden" }}>
        <Cover uri={image} icon={icon} size={grid ? 36 : 26} />
        {!!corner && <View style={{ position: "absolute", top: grid ? 8 : 4, right: grid ? 8 : 4 }}>{corner}</View>}
      </View>
      <View style={{ flex: grid ? undefined : 1, minWidth: 0, gap: 4, padding: grid ? spacing.sm : 0 }}>
        <Copy kind="label" numberOfLines={2} style={grid ? { minHeight: Math.ceil(44 * fontScale) } : undefined}>{title}</Copy>
        <Copy kind="small" tone="muted" numberOfLines={1}>{meta}</Copy>
        {!grid && !!creator && <Copy kind="small" tone="muted" numberOfLines={1}>By {creator}</Copy>}
        {note}
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
  const mosaic = covers.length >= 4;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count} ${count === 1 ? "workout" : "workouts"}`}
      accessibilityHint="Opens this collection"
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{ width: 128, gap: 6, opacity: press.opacity, transform: [{ scale: press.scale }] }}
    >
      <View style={{ width: 128, height: 88, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: c.border,
        flexDirection: "row", flexWrap: "wrap", gap: 1, backgroundColor: c.border }}>
        {mosaic ? covers.slice(0, 4).map((uri, index) => <View key={index} style={{ width: 62.5, height: 42.5 }}>
          <Cover uri={uri} icon="image-outline" size={18} />
        </View>) : <Cover uri={covers[0]} icon="folder-open-outline" size={28} />}
      </View>
      <View>
        <Copy kind="label" numberOfLines={1}>{title}</Copy>
        <Copy kind="small" tone="muted">{count} {count === 1 ? "workout" : "workouts"}</Copy>
      </View>
    </AnimatedPressable>
  );
}
