import { workoutCardMeta } from "@/lib/library-view";
import { LibraryCard } from "./library-card";
import { platformInfo } from "@/lib/discover";
import { workoutGridWidth } from "@/lib/readable-layout";
import { Children, type PropsWithChildren } from "react";
import { View, useWindowDimensions } from "react-native";
import { Skeleton } from "@/components/ui";
import { radii } from "@/constants/theme";
import { type DiscoverCard } from "@/lib/discover";

const GRID_GAP = 12;
/** Card width: two columns on phones, three when a tablet gives each card enough room. */
function useGridCell() {
  const { width, fontScale } = useWindowDimensions();
  return workoutGridWidth(width, fontScale, true);
}
const gridStyle = { flexDirection: "row", flexWrap: "wrap", columnGap: GRID_GAP, rowGap: 20 } as const;

export function DiscoverGrid({ children }: PropsWithChildren) {
  const cell = useGridCell();
  return (
    <View style={gridStyle}>
      {Children.map(children, (child) => (child == null ? null : <View style={{ width: cell }}>{child}</View>))}
    </View>
  );
}

/** Discover and Library share the same photo, title and single credit line. */
export function DiscoverGridCard({ card, onPress, onSave, saving = false }: { card: DiscoverCard; onPress(): void; onSave?(): void; saving?: boolean }) {
  return <LibraryCard fill view="grid" title={card.title} meta={workoutCardMeta(card)}
    creator={card.source_creator || card.contributor.display_name} origin={platformInfo(card.source_platform).label}
    image={card.thumbnail_url} icon="barbell-outline" favorite={false} onPress={onPress}
    save={!card.is_owner && onSave ? { saved: !!card.saved_workout_id, busy: saving, onPress: onSave } : undefined} />;
}

export function DiscoverGridSkeleton({ count = 4 }: { count?: number }) {
  const cell = useGridCell();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading workouts" style={gridStyle}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: cell, gap: 8 }}>
          <Skeleton height={cell * 5 / 4} radius={radii.lg - 4} />
          <Skeleton height={16} width="85%" />
          <Skeleton height={14} width="55%" />
        </View>
      ))}
    </View>
  );
}
