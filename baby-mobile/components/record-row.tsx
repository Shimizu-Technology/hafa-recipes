import { router } from "expo-router";
import type { BabyRecord, Kind } from "@/lib/models";
import { kindName } from "@/lib/models";
import { careSummary, friendlyTime, isCare } from "@/lib/care-format";
import { useBaby } from "@/lib/context";
import { Row, type IconName } from "./ui";
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
};
/** `now` lets a screen share one clock between rows and its summary so durations agree. */
export function RecordRow({ record, pending = false, now }: { record: BabyRecord; pending?: boolean; now?: Date }) {
  const children = useBaby().state.bootstrap?.children ?? [],
    care = isCare(record.kind),
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
      title={care ? careSummary(record.kind, record.data, record.occurred_at, now) : label || kindName[record.kind]}
      detail={details}
      numericTitle={care}
      numericDetail
      icon={kindIcon[record.kind]}
      onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    />
  );
}
