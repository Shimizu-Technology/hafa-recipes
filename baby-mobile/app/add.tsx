import { router } from "expo-router";
import { Grouped, Row, Screen } from "@/components/ui";
import type { Kind } from "@/lib/models";
import { kindIcon } from "@/components/record-row";
import { useBaby } from "@/lib/context";
import { careLogsStarted, profileToday } from "@/lib/timing";

const careKinds: Kind[] = ["feeding", "sleep", "diaper"];

export default function Add() {
  const b = useBaby(), bootstrap = b.state.bootstrap,
    // Before birth the sheet matches Today: no feed, sleep or diaper logs to choose from.
    care = !bootstrap || careLogsStarted(bootstrap.children, profileToday(new Date(), bootstrap.profile.timezone));
  return (
    <Screen title="What’s on your mind?" subtitle="Save it now. Find it when you need it." close>
      <Grouped>{(
        [
          { kind: "source", title: "Save a source", detail: "Video, link, screenshot, or document" },
          { kind: "journal", title: "Write in your journal", detail: "A thought, a memory, or a photo" },
          { kind: "feeding", title: "Log a feeding", detail: "Breast, bottle, or something else" },
          { kind: "sleep", title: "Log sleep", detail: "Start now or record a past sleep" },
          { kind: "diaper", title: "Log a diaper", detail: "A quick update for the care history" },
          { kind: "question", title: "Keep a doctor question", detail: "Bring your questions to the next visit" },
          { kind: "routine", title: "Make a routine or checklist", detail: "Review the plan before reminders start" },
          { kind: "collection", title: "Organize a collection", detail: "Keep related saved sources together" },
        ] as { kind: Kind; title: string; detail: string }[]
      ).filter((item) => care || !careKinds.includes(item.kind)).map((item) => (
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
