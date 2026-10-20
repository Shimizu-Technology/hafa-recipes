import { router } from "expo-router";
import type { BabyRecord, Kind } from "@/lib/models";
import { kindName } from "@/lib/models";
import { Row, type IconName } from "./ui";
export const kindIcon: Record<Kind, IconName> = {
  source: "bookmark-outline",
  journal: "book-outline",
  feeding: "water-outline",
  sleep: "moon-outline",
  diaper: "sunny-outline",
  routine: "checkmark-circle-outline",
  question: "chatbubble-ellipses-outline",
  collection: "folder-outline",
};
export function RecordRow({ record, pending = false }: { record: BabyRecord; pending?: boolean }) {
  const details = [
    record.data.provenance === "clinician_instruction" ? "Clinician instruction" : kindName[record.kind],
    new Date(record.occurred_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    pending ? "Saved on this device" : record.kind === "source" ? String(record.data.status ?? "") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      title={record.title || kindName[record.kind]}
      detail={details}
      icon={kindIcon[record.kind]}
      onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    />
  );
}
