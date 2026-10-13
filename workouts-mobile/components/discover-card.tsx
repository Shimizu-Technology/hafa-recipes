import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BrandMark, Copy, MediaCard, Row, Skeleton, useColors } from "@/components/ui";
import { radii } from "@/constants/theme";
import { cardMeta, creatorCredit, equipmentChips, platformInfo, type DiscoverCard } from "@/lib/discover";

const PATTERN_ROWS = 4;
const PATTERN_COLUMNS = 5;

/**
 * Artwork for a workout without a thumbnail: the reef hero surface with a quiet
 * latte-stone pattern and the source platform's icon. Decorative only.
 */
export function SourceArtwork({ platform, height = 168, compact = false }: { platform: string | null; height?: number; compact?: boolean }) {
  const c = useColors();
  const info = platformInfo(platform);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: "100%", height, backgroundColor: c.hero, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
    >
      {!compact && (
        <View style={{ position: "absolute", top: -10, left: -18, right: -18, bottom: -10, opacity: 0.12, gap: 14 }}>
          {Array.from({ length: PATTERN_ROWS }, (_, row) => (
            <View key={row} style={{ flexDirection: "row", gap: 26, marginLeft: row % 2 ? 34 : 0 }}>
              {Array.from({ length: PATTERN_COLUMNS }, (_, column) => (
                <BrandMark key={column} height={26} mono={c.onHero} />
              ))}
            </View>
          ))}
        </View>
      )}
      <View
        style={{
          width: compact ? 44 : 64,
          height: compact ? 44 : 64,
          borderRadius: radii.full,
          backgroundColor: c.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={info.icon} size={compact ? 22 : 32} color={c.onAccent} />
      </View>
      {!compact && (
        <View
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: radii.full,
            backgroundColor: c.onHeroSoft,
          }}
        >
          <Copy kind="small" color={c.onHero} style={{ fontSize: 13, lineHeight: 18 }}>
            {platform ? info.label : "Håfa"}
          </Copy>
        </View>
      )}
    </View>
  );
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
      placeholder={<SourceArtwork platform={card.source_platform} />}
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
      style={{ borderRadius: radii.xl - 4, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: 16, gap: 12 }}
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
