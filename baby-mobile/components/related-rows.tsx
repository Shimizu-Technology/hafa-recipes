import { View } from "react-native";
import { router } from "expo-router";
import type { BabyRecord } from "../lib/models";
import { useBaby } from "@/lib/context";
import { keyDate, recordDay } from "../lib/tracker";
import { profileToday, timingChild } from "../lib/timing";
import { babyLabel } from "../lib/spaces";
import { Grouped, Row, Section } from "./ui";
import { RecordVisit } from "./visit-sections";

/** A day in words, with its year once it isn't this one. */
function dayWords(key: string, today: Date) {
  const date = keyDate(key);
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

/**
 * Where a piece of writing connects: its day, its baby, its visit. Each comes from the row itself and what this account can
 * read, so nothing here can speak of someone else's private writing. A baby it can't read has no row. The day is the one
 * Tracker files it under, on the family's clock, so the row and where it lands agree. They push, so Back finds everything
 * under them as she left it, and Tracker takes its baby from the link and leaves the one she has selected alone.
 */
export function RelatedRows({ record }: { record: BabyRecord }) {
  const b = useBaby(), bootstrap = b.state.bootstrap!, zone = bootstrap.profile.timezone, today = profileToday(new Date(), zone),
    day = recordDay(record.occurred_at, zone),
    baby = bootstrap.children.find((child) => child.id === record.child_id),
    // Writing for nobody in particular shows on every baby's day, so it opens on the baby Tracker would show.
    shownFor = baby ?? timingChild(b.state, today);
  return <Section title="Related">
    {/* To the card's edges, since its rows bring their own inset and at the largest text they need the width. */}
    <View style={{ marginHorizontal: -16, marginBottom: -12 }}>
      {(!!day || !!baby) && <Grouped>
        {!!day && <Row numericTitle title={`On ${dayWords(day, today)}`} detail="Open this day" icon="calendar-outline"
          onPress={() => router.push({ pathname: "/day", params: { day, child: shownFor?.id, at: String(Date.now()) } })} />}
        {!!baby && <Row title={`For ${babyLabel(baby, bootstrap)}`} detail="Baby profile" icon="person-outline"
          onPress={() => router.push({ pathname: "/child", params: { id: baby.id } })} />}
      </Grouped>}
      <RecordVisit record={record} />
    </View>
  </Section>;
}
