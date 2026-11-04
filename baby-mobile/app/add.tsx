import { router } from "expo-router";
import { Grouped, Row, Screen } from "@/components/ui";
import type { Kind } from "@/lib/models";
import { kindIcon } from "@/components/record-row";

/** Things to keep. Care is logged from Today and Tracker, one tap away, so it isn't here. */
const items: { kind: Kind; title: string; detail: string }[] = [
  { kind: "source", title: "Save a video or link", detail: "Video, link, screenshot, or document" },
  { kind: "journal", title: "Write in your journal", detail: "A thought, a memory, or a photo" },
  { kind: "question", title: "Keep a doctor question", detail: "Bring your questions to the next visit" },
  { kind: "routine", title: "Make a list", detail: "A checklist or a routine you review first" },
];

export default function Add() {
  return (
    <Screen title="What’s on your mind?" subtitle="Save it now. Find it when you need it." close>
      <Grouped>{items.map((item) => (
        <Row
          key={item.kind}
          title={item.title}
          detail={item.detail}
          icon={kindIcon[item.kind]}
          onPress={() => router.replace({ pathname: "/edit", params: { kind: item.kind } })}
        />
      ))}</Grouped>
    </Screen>
  );
}
