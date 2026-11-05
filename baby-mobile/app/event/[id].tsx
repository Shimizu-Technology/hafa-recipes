import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { categoryName, dayName, eventWhen, occurrenceAt, reminderName, repeatName, withoutDate, withoutFuture } from "@/lib/events";
import { messageFor, type BabyRecord } from "@/lib/models";
import { mutationRecordIds, replaceRecord } from "@/lib/outbox";
import { dayKey, recordDay } from "@/lib/tracker";
import { profileToday } from "@/lib/timing";
import { Button, Card, Copy, Grouped, Loading, Notice, Row, Screen, useToast } from "@/components/ui";
import { CategoryTile, openEvent } from "@/components/event-row";
import { VisitSections } from "@/components/visit-sections";
import { useUpcomingEvents } from "@/lib/use-events";
import { visitAfter } from "@/lib/visits";

/** One event, on the date she opened. A repeating event says which dates a change reaches before making it. */
export default function EventDetail() {
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>(), b = useBaby(), toast = useToast(),
    [error, setError] = useState(""), [missing, setMissing] = useState(false), [asking, setAsking] = useState<"edit" | "delete" | null>(null),
    row = b.records.find((item) => item.id === id && item.kind === "event"), timezone = b.state.bootstrap!.profile.timezone,
    today = dayKey(profileToday(new Date(), timezone)), children = b.state.bootstrap!.children, upcoming = useUpcomingEvents(row?.child_id ?? null, today);
  useEffect(() => {
    if (row && !row.cache_partial) return;
    let active = true;
    void b.api.record(id).then((found) => { if (active) void b.commit((s) => ({ ...s, records: replaceRecord(s.records, found) })); })
      .catch((e) => { if (active) { setError(messageFor(e)); setMissing(true); } });
    return () => { active = false; };
  }, [id]);
  if (!row) return <Screen title={missing ? "Event unavailable" : "Opening this event"} back>{error ? <Notice error>{error}</Notice> : <Loading />}</Screen>;
  const shown = occurrenceAt(row, at), when = eventWhen(shown, today, timezone), original = shown.original_start, repeating = !!row.data.recurrence,
    date = dayName(recordDay(shown.occurrence_start, shown.all_day ? shown.timezone : timezone), today),
    child = children.find((item) => item.id === row.child_id), pending = b.state.outbox.some((m) => mutationRecordIds(m).includes(row.id) && m.type !== "import");
  const appointment = shown.category === "appointment", booked = appointment ? visitAfter(upcoming.items, shown) : undefined;
  const edit = (scope?: "one" | "future") => router.push({ pathname: "/edit", params: { kind: "event", id: row.id, ...(scope ? { scope, at: original } : {}) } });
  async function save(record: BabyRecord) {
    await b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", record, files: [] });
  }
  async function remove(change: () => Promise<void>, message: string) {
    setError("");
    try { await change(); toast(message); router.back(); } catch (e) { setError(messageFor(e)); }
  }
  const deleteAll = () => b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "delete", record: row });
  const scopes = asking && <Card tone="soft" style={{ gap: 8 }}>
    <Copy kind="label">{asking === "edit" ? "This event repeats. What should change?" : "This event repeats. What should go?"}</Copy>
    <Grouped>
      <Row title="Just this one" detail={`${asking === "edit" ? "Changes" : "Removes"} ${date} only. The other dates stay as they are.`} numericDetail
        onPress={() => asking === "edit" ? edit("one") : void remove(() => save(withoutDate(row, original)), `Removed ${date}.`)} />
      <Row title="All future" detail={`${asking === "edit" ? "Changes" : "Removes"} ${date} and every date after it. Earlier dates stay as they are.`} numericDetail
        onPress={() => {
          if (asking === "edit") return edit("future");
          const ended = withoutFuture(row, original);
          void remove(() => ended ? save(ended) : deleteAll(), ended ? `Removed ${date} and later dates.` : "Event removed.");
        }} />
    </Grouped>
    <Button variant="ghost" title="Keep as it is" onPress={() => setAsking(null)} />
  </Card>;
  return <Screen title={categoryName(shown.category)} back>
    {!!error && <Notice error>{error}</Notice>}
    {pending && <Notice>Saved on this phone. It will sync when a connection is available.</Notice>}
    <Card tone="hero" style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CategoryTile category={shown.category} size={44} />
        <View style={{ flex: 1 }}><Copy kind="heading">{shown.title}</Copy></View>
      </View>
      <Copy numeric>{when}</Copy>
      {!!shown.location && <Copy>{shown.location}</Copy>}
      {shown.attendees.length > 0 && <Copy>With {shown.attendees.join(", ")}</Copy>}
      <Copy kind="small" tone="muted">{child?.name ?? "Whole family"}{repeating ? ` · ${repeatName(row.data.recurrence)}` : ""}</Copy>
      {!!row.body && <Copy>{row.body}</Copy>}
      {!!row.data.reminder_minutes?.length && <Copy kind="small" tone="muted">{`Reminder: ${row.data.reminder_minutes.map((minutes) => reminderName(minutes, shown.all_day)).join(", ")}`}</Copy>}
    </Card>
    {appointment && <Button size="lg" icon="calendar-outline" title="Book next"
      onPress={() => router.push({ pathname: "/edit", params: { kind: "event", from: row.id, at: original } })} />}
    {booked && <Row numericDetail title="Next visit" detail={eventWhen(booked, today, timezone)} icon="calendar-outline" onPress={() => openEvent(booked)} />}
    {appointment && <VisitSections visit={row} />}
    {asking === "edit" ? scopes : <Button secondary size="lg" icon="pencil-outline" title="Edit event" onPress={() => repeating ? setAsking("edit") : edit()} />}
    {asking === "delete" ? scopes : <Button variant="destructive" title="Delete event" onPress={() => repeating ? setAsking("delete") : Alert.alert("Delete this event?", appointment ? "This removes it from your calendar. Its questions and notes stay in your Journal." : "This removes it from your calendar.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete event", style: "destructive", onPress: () => void remove(deleteAll, "Event removed.") },
    ])} />}
  </Screen>;
}
