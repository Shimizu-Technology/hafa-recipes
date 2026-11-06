import { router } from "expo-router";
import type { BabyRecord, Kind } from "@/lib/models";
import { kindName, kindWord } from "@/lib/models";
import { careSummary, friendlyTime, summaryHoldsTitle, timeBesideDate } from "@/lib/care-format";
import { trackerFor, whoseLog } from "../lib/trackers";
import { familyLine } from "../lib/logged-by";
import { visibilityWord } from "../lib/spaces";
import { datedOnly } from "../lib/well-visits";
import { contractionDetail } from "../lib/contractions";
import { kickDetail } from "../lib/kicks";
import { keyDate, recordDay } from "../lib/tracker";
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
  const baby = useBaby(), bootstrap = baby.state.bootstrap, children = bootstrap?.children ?? [],
    tracker = trackerFor(record), dated = datedOnly(record),
    // Logs read on the family's clock, as they do in Tracker. Everything else keeps the phone's.
    clock = tracker ? bootstrap?.profile.timezone : undefined,
    summary = careSummary(record.kind, record.data, record.occurred_at, now, clock),
    quick = tracker?.opens === "quick-log",
    label = record.title && record.title !== kindName[record.kind] ? record.title : "",
    // A shot or milestone goes by its own name, and its noon is only how the date is stored.
    title = dated ? record.title : summary || record.data.label || label || kindWord(record.kind),
    child = children.length > 1 ? children.find((c) => c.id === record.child_id)?.name : undefined;
  const details = [
    dated ? record.data.label ?? kindWord(record.kind)
      : quick ? label
      : tracker ? (summaryHoldsTitle(record.kind, record.title, summary) || record.title === title ? "" : record.title)
      : record.data.provenance === "clinician_instruction" ? "Clinician instruction" : kindWord(record.kind),
    !tracker || quick ? "" : record.kind === "contraction" ? contractionDetail(record, now) : record.kind === "kick_session" ? kickDetail(record, now) : record.body.trim().split("\n")[0],
    dated ? keyDate(recordDay(record.occurred_at, bootstrap?.profile.timezone)).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : record.kind === "journal" || record.kind === "question" ? timeBesideDate(record.occurred_at, now, clock) : friendlyTime(record.occurred_at, now, clock),
    whoseLog(record),
    child,
    visibilityWord(record, bootstrap),
    familyLine(record, baby.records ?? [], bootstrap, baby.owner),
    pending ? "Saved on this device" : record.kind === "source" ? String(record.data.status ?? "") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (record.kind === "source") return <SavedPostRow record={record} pending={pending} />;
  return (
    <Row
      title={title}
      detail={details}
      numericTitle={!!summary}
      numericDetail
      icon={recordIcon(record)}
      leading={record.kind === "journal" || record.kind === "question" ? <DateBlock iso={record.occurred_at} /> : undefined}
      onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    />
  );
}
