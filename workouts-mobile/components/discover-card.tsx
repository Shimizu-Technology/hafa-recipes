import type { FormatBlock } from "@/lib/timed-execution";
import { WorkoutArt } from "./workout-art";
import { View, type DimensionValue } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Copy, MediaCard, Row, Skeleton, useColors } from "@/components/ui";
import { radii } from "@/constants/theme";
import { cardMeta, creatorCredit, equipmentChips, platformInfo, type DiscoverCard } from "@/lib/discover";

/** Athletic format cover shared with Library and saved workout detail. */
export function SourceArtwork({ platform, height = 168, compact = false, title = "Workout", meta, blocks }: {
  blocks?: FormatBlock[];
  platform: string | null; height?: DimensionValue; compact?: boolean; title?: string; meta?: string;
}) {
  return <View style={{ width: "100%", height, overflow: "hidden" }}><WorkoutArt title={title} meta={meta ?? platformInfo(platform).label} compact={compact} blocks={blocks} /></View>;
}

export function DiscoverCardView({ card, onPress }: { card: DiscoverCard; onPress(): void }) {
  const credit = creatorCredit(card);
  const badge = card.is_owner ? "Yours" : card.saved_workout_id ? "Saved" : undefined;
  return (
    <MediaCard
      layout="stacked"
      title={card.title}
      meta={cardMeta(card)}
      image={card.thumbnail_url}
      placeholder={<SourceArtwork platform={card.source_platform} title={card.title} blocks={card.format ? [card.format] : undefined} meta={cardMeta(card).split(" · ")[0]} />}
      chips={equipmentChips(card)}
      badge={badge}
      footer={credit ? <CreditLine platform={card.source_platform} text={credit} /> : null}
      accessibilityLabel={[
        card.title,
        cardMeta(card),
        equipmentChips(card).join(", "),
        credit ? `Original by ${credit}` : null,
        badge === "Saved" ? "Saved to your library" : badge === "Yours" ? "Shared by you" : null,
      ]
        .filter(Boolean)
        .join(". ")}
      onPress={onPress}
    />
  );
}

export function CreditLine({ platform, text }: { platform: string | null; text: string }) {
  const c = useColors();
  return (
    <Row gap={6}>
      <Ionicons name={platformInfo(platform).icon} size={15} color={c.muted} />
      <Copy kind="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
        {text}
      </Copy>
    </Row>
  );
}

export function DiscoverCardSkeleton() {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading workouts"
      style={{ borderRadius: radii.xl - 4, backgroundColor: c.surface, padding: 16, gap: 12 }}
    >
      <Skeleton height={168} radius={radii.lg - 4} />
      <Skeleton height={22} width="70%" />
      <Skeleton height={14} width="50%" />
      <Row gap={8}>
        <Skeleton height={28} width={90} radius={radii.full} />
        <Skeleton height={28} width={70} radius={radii.full} />
      </Row>
    </View>
  );
}
