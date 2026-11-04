import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { careGlance } from "@/lib/care-glance";
import { useTodayCare } from "@/lib/today-care";
import { Copy, Empty, Grouped, Row, Screen } from "@/components/ui";
import { RecordRow } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { useMinuteClock } from "@/components/care-glance";

/** Today's care, newest first. The Day and Month views replace this list. */
export default function Tracker() {
  const b = useBaby(), now = useMinuteClock(), care = useTodayCare(),
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    rows = care.all.filter((row) => new Date(row.occurred_at).getTime() >= start),
    children = b.state.bootstrap!.children,
    feeds = careGlance(rows, b.state.selectedChild ?? children[0]?.id ?? null, now).feeds;
  return (
    <Screen title="Tracker" onRefresh={() => care.refresh()}>
      <Copy numeric kind="small" tone="muted">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Copy>
      <SyncStatus />
      {children.length > 1 && <ChildFilter />}
      {rows.length ? <Grouped>{rows.map((row) => (
        <RecordRow key={row.id} record={row} now={now}
          pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === row.id)} />
      ))}</Grouped> : <Empty icon="calendar-outline" title="Nothing logged today"
        body="Feeds, sleep and diapers you log on Today show up here." />}
      <Grouped>
        <Row title="Care history" detail={feeds ? `${feeds} feed${feeds === 1 ? "" : "s"} today · All care logs` : "All care logs"} numericDetail
          icon="time-outline" onPress={() => router.push("/care-history")} />
      </Grouped>
    </Screen>
  );
}
