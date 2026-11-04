import { router } from "expo-router";
import type { BabyRecord, Kind } from "@/lib/models";
import { kindName } from "@/lib/models";
import { careSummary, friendlyTime } from "@/lib/care-format";
import { trackerFor } from "../lib/trackers";
import { useBaby } from "@/lib/context";
import { Text, View } from "react-native";
import { Row, fonts, useColors, type IconName } from "./ui";
import { SavedPostRow } from "./saved-post-row";
export const kindIcon: Record<Kind, IconName> = {
  source: "bookmark-outline",
  journal: "book-outline",
  feeding: "care:baby-bottle-outline",
  sleep: "moon-outline",
  diaper: "care:human-baby-changing-table",
  routine: "checkmark-circle-outline",
  question: "chatbubble-ellipses-outline",
  collection: "folder-outline",
  contraction: "pulse-outline",
  kick_session: "footsteps-outline",
  pumping: "water-outline",
  medicine: "bandage-outline",
  temperature: "thermometer-outline",
  growth: "trending-up-outline",
  milestone: "ribbon-outline",
  custom: "medkit-outline",
  event: "calendar-outline",
};
/** Its tracker's icon. A shot has none, and keeps the medical cross. */
export const recordIcon = (record: Pick<BabyRecord, "kind" | "data">): IconName => (record.kind === "custom" && trackerFor(record)?.icon) || kindIcon[record.kind];
/** Journal entries and doctor questions lead with their date, not the same glyph on every row. Decorative: the row says the time. */
export function DateBlock({ iso }: { iso: string }) {
  const c = useColors(), date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return <View accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.placeholder, alignItems: "center", justifyContent: "center" }}>
    <Text allowFontScaling={false} style={{ fontFamily: fonts.bold, fontSize: 10, lineHeight: 12, letterSpacing: 0.6, color: c.placeholderInk }}>
      {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
    </Text>
    <Text allowFontScaling={false} style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: c.text, fontVariant: ["tabular-nums"] }}>{date.getDate()}</Text>
  </View>;
}
/** `now` lets a screen share one clock between rows and its summary so durations agree. */
export function RecordRow({ record, pending = false, now }: { record: BabyRecord; pending?: boolean; now?: Date }) {
  const children = useBaby().state.bootstrap?.children ?? [],
    summary = careSummary(record.kind, record.data, record.occurred_at, now),
    care = !!summary,
    label = record.title && record.title !== kindName[record.kind] ? record.title : "",
    child = children.length > 1 ? children.find((c) => c.id === record.child_id)?.name : undefined;
  const details = [
    care ? label : record.data.provenance === "clinician_instruction" ? "Clinician instruction" : kindName[record.kind],
    friendlyTime(record.occurred_at, now),
    child,
    pending ? "Saved on this device" : record.kind === "source" ? String(record.data.status ?? "") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (record.kind === "source") return <SavedPostRow record={record} pending={pending} />;
  return (
    <Row
      title={summary || record.data.label || label || kindName[record.kind]}
      detail={details}
      numericTitle={care}
      numericDetail
      icon={recordIcon(record)}
      leading={record.kind === "journal" || record.kind === "question" ? <DateBlock iso={record.occurred_at} /> : undefined}
      onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    />
  );
}
