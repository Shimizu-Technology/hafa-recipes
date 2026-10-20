import { Children, useState, type PropsWithChildren } from "react";
import { View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Copy, Skeleton, useColors, useReducedMotion } from "@/components/ui";
import { animatedPressableComponent, usePressScale } from "@/components/design/press";
import { SourceArtwork } from "@/components/discover-card";
import { contentWidth, motion, radii, spacing } from "@/constants/theme";
import { cardMeta, creatorCredit, gridByline, type DiscoverCard } from "@/lib/discover";

const GRID_GAP = spacing.sm;
/** Screen's horizontal padding on each side (spacing.lg - 4). */
const SCREEN_GUTTER = (spacing.lg - 4) * 2;

/** Card width: two columns on phones, three when a tablet gives each card enough room. */
function useGridCell() {
  const { width } = useWindowDimensions();
  const inner = Math.min(width, contentWidth) - SCREEN_GUTTER;
  const columns = inner >= 560 ? 3 : 2;
  return Math.floor((inner - GRID_GAP * (columns - 1)) / columns);
}
const gridStyle = { flexDirection: "row", flexWrap: "wrap", columnGap: GRID_GAP, rowGap: GRID_GAP } as const;

export function DiscoverGrid({ children }: PropsWithChildren) {
  const cell = useGridCell();
  return (
    <View style={gridStyle}>
      {Children.map(children, (child) => (child == null ? null : <View style={{ width: cell }}>{child}</View>))}
    </View>
  );
}

/** Photo-first Discover card: square cover with a time badge, two-line title, byline. */
export function DiscoverGridCard({ card, onPress }: { card: DiscoverCard; onPress(): void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const press = usePressScale();
  const { fontScale } = useWindowDimensions();
  const [failed, setFailed] = useState<string | null>(null);
  const AnimatedPressable = animatedPressableComponent();
  const image = card.thumbnail_url && card.thumbnail_url !== failed ? card.thumbnail_url : null;
  const badge = card.is_owner ? "Yours" : card.saved_workout_id ? "Saved" : null;
  const credit = creatorCredit(card);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={[
        card.title,
        cardMeta(card),
        credit ? `Original by ${credit}` : null,
        badge === "Saved" ? "Saved to your library" : null,
      ]
        .filter(Boolean)
        .join(". ")}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{
        borderRadius: radii.lg - 4,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        overflow: "hidden",
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      <View style={{ width: "100%", aspectRatio: 1, backgroundColor: c.sunken }}>
        {image ? (
          <Image
            source={{ uri: image }}
            onError={() => setFailed(image)}
            contentFit="cover"
            transition={reduced ? 0 : motion.base}
            style={{ width: "100%", height: "100%" }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <SourceArtwork platform={card.source_platform} height="100%" compact />
        )}
        {!!card.estimated_minutes && (
          <Pill icon="time-outline" label={`${card.estimated_minutes} min`} position={{ left: 8, bottom: 8 }} />
        )}
        {!!badge && (
          <Pill icon={badge === "Saved" ? "checkmark-circle" : "person"} label={badge} position={{ right: 8, top: 8 }} />
        )}
      </View>
      <View style={{ padding: spacing.sm, gap: 4 }}>
        <Copy kind="label" numberOfLines={2} style={{ minHeight: Math.ceil(44 * fontScale) }}>
          {card.title}
        </Copy>
        <Copy kind="small" tone="muted" numberOfLines={1}>
          {gridByline(card)}
        </Copy>
      </View>
    </AnimatedPressable>
  );
}

function Pill({
  icon,
  label,
  position,
}: {
  icon: "time-outline" | "checkmark-circle" | "person";
  label: string;
  position: { left?: number; right?: number; top?: number; bottom?: number };
}) {
  const c = useColors();
  return (
    <View
      style={{
        position: "absolute",
        ...position,
        maxWidth: "80%",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.full,
        backgroundColor: c.elevated,
      }}
    >
      <Ionicons name={icon} size={13} color={c.text} />
      <Copy kind="caption" numberOfLines={1}>
        {label}
      </Copy>
    </View>
  );
}

export function DiscoverGridSkeleton({ count = 4 }: { count?: number }) {
  const cell = useGridCell();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading workouts" style={gridStyle}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: cell, gap: 8 }}>
          <Skeleton height={cell} radius={radii.lg - 4} />
          <Skeleton height={16} width="85%" />
          <Skeleton height={14} width="55%" />
        </View>
      ))}
    </View>
  );
}
