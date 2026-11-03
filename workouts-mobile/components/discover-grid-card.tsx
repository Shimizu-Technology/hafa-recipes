import { EntranceItem, type EntranceBudget } from "./design/athletic-motion";
import { workoutCardMeta } from "@/lib/library-view";
import { LibraryCard } from "./library-card";
import { discoverFormatLabel, platformInfo } from "@/lib/discover";
import { workoutGridWidth } from "@/lib/readable-layout";
import { Children, useRef, type PropsWithChildren } from "react";
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
  const entrance = useRef<EntranceBudget>({ ids: null, seen: new Set() });
  const items = Children.toArray(children);
  if (!entrance.current.ids && items.length) entrance.current.ids = items.slice(0, 6).map((child, i) => String((child as { key?: string }).key ?? i));
  return (
    <View style={gridStyle}>
      {items.map((child, i) => <View key={String((child as { key?: string }).key ?? i)} style={{ width: cell }}><EntranceItem id={String((child as { key?: string }).key ?? i)} budget={entrance.current}>{child}</EntranceItem></View>)}
    </View>
  );
}

/** Discover and Library share the same photo, title and single credit line. */
export function DiscoverGridCard({ card, onPress, onSave, saving = false }: { card: DiscoverCard; onPress(): void; onSave?(): void; saving?: boolean }) {
  return <LibraryCard blocks={card.format ? [card.format] : undefined} fill view="grid" title={card.title} meta={discoverFormatLabel(card) || workoutCardMeta(card)}
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
