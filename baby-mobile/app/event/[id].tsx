import { estimatedAge, pregnancyVisit, medicalVisit } from "../../lib/prenatal";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { dayName, eventKindName, eventWhen, occurrenceAt, reminderName, repeatName, withoutDate, withoutFuture } from "@/lib/events";
import { messageFor, type BabyRecord } from "@/lib/models";
import { mutationRecordIds, replaceRecord } from "@/lib/outbox";
import { dayKey, recordDay, zonedInstant } from "@/lib/tracker";
import { profileToday } from "@/lib/timing";
import { Button, Card, Copy, Grouped, Loading, Notice, Row, Screen, useToast } from "@/components/ui";
import { CategoryTile, openEvent } from "@/components/event-row";
import { EventNotes, VisitLinks, VisitSections } from "@/components/visit-sections";
import { useUpcomingEvents } from "@/lib/use-events";
import { visitAfter, visitNotes, visitQuestions } from "@/lib/visits";
import { familySpaces } from "../../lib/spaces";
import { addToPhoneCalendar, phoneCalendarAvailable, phoneEvent, phoneEventLine } from "@/lib/phone-calendar";

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
  const family = familySpaces(b.state.bootstrap)[0], inFamily = !!family && !!row.space_id, justMe = inFamily && row.space_id !== family.id;
  const medical = !medicalVisit(row.data) || familySpaces(b.state.bootstrap).find((space) => space.id === row.space_id)?.role !== "caregiver";
  const appointment = shown.category === "appointment", booked = appointment ? visitAfter(upcoming.items, shown) : undefined;
  const edit = (scope?: "one" | "future") => router.push({ pathname: "/edit", params: { kind: "event", id: row.id, ...(scope ? { scope, at: original } : {}) } });
  async function save(record: BabyRecord) {
    await b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", record, files: [] });
  }
  async function remove(change: () => Promise<void>, message: string) {
    setError("");
    try { await change(); toast(message); router.back(); } catch (e) { setError(messageFor(e)); }
  }
  async function addToPhone() {
    const result = await addToPhoneCalendar(phoneEvent(row!, shown));
    if (result === "saved") toast("Added to your phone’s calendar.");
    if (result === "unavailable") toast("Your phone’s calendar couldn’t open.");
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
  return <Screen title={eventKindName(shown) || "Event"} back>
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
      <Copy kind="small" tone="muted">{[child?.name ?? (inFamily && !justMe ? "Whole family" : "Personal"), repeating && repeatName(row.data.recurrence), inFamily && (justMe ? "Just me" : "Shared with family")].filter(Boolean).join(" · ")}</Copy>
      {medical && appointment && !!estimatedAge(recordDay(shown.occurrence_start, shown.timezone), row.data.due_date_snapshot ?? child?.due_date, child?.birth_date) && <Copy kind="small" tone="muted">Estimated from due date: {estimatedAge(recordDay(shown.occurrence_start, shown.timezone), row.data.due_date_snapshot ?? child?.due_date, child?.birth_date)}</Copy>}
      {medical && pregnancyVisit(recordDay(shown.occurrence_start, shown.timezone), child?.birth_date) && !!row.data.clinician_age && <Copy>Clinic’s stated week: {row.data.clinician_age}</Copy>}
      {medical && !!row.data.doctor && <Copy>Doctor: {row.data.doctor}</Copy>}
      {medical && (!!row.data.results || !!row.data.result_status) && <Copy>Results ({row.data.result_status ?? "unknown"}){row.data.results ? `: ${row.data.results}` : ""}</Copy>}
      {medical && !!row.data.follow_up && <Copy>Follow up: {row.data.follow_up}</Copy>}
      {medical && !!row.data.paste_origin && <><Copy kind="small" tone="muted">Original words</Copy><Copy>{row.data.paste_origin.text}</Copy></>}
      {(!medicalVisit(row.data) || medical) && !!row.body && <Copy>{row.body}</Copy>}
      {!!b.state.bootstrap!.reminders?.push && !!row.data.reminder_minutes?.length && <Copy kind="small" tone="muted">{`Reminder: ${row.data.reminder_minutes.map((minutes) => reminderName(minutes, shown.all_day)).join(", ")}`}</Copy>}
    </Card>
    {medical && !!row.data.follow_up && <Button secondary title="Make a follow-up calendar item" onPress={() => void (async () => {
      const id = Crypto.randomUUID(), slot = `follow-up:${id}`;
      await b.commit((state) => ({ ...state, drafts: { ...state.drafts, [slot]: { id, kind: "event", title: "Follow up", body: row.data.follow_up!, child_id: child?.space_id && child.space_id !== b.state.bootstrap!.personal_space_id ? null : row.child_id, occurred_at: zonedInstant(today, 0, 0, timezone).toISOString(), files: [], shared: false,
        data: { timezone, category: "reminder", all_day: true, reminder_minutes: [] } } } }));
      router.push({ pathname: "/edit", params: { draft: slot, kind: "event" } });
    })().catch((e) => setError(messageFor(e)))} />}
    {appointment && medical && <Button size="lg" icon="calendar-outline" title="Book next"
      onPress={() => router.push({ pathname: "/edit", params: { kind: "event", from: row.id, at: original } })} />}
    {booked && <Row numericDetail title="Next visit" detail={eventWhen(booked, today, timezone)} icon="calendar-outline" onPress={() => openEvent(booked)} />}
    {medical && (appointment ? <VisitSections visit={{ ...row, occurred_at: shown.occurrence_start, data: { ...row.data, all_day: shown.all_day } }} /> : familySpaces(b.state.bootstrap).find((space) => space.id === row.space_id)?.role === "caregiver" ? <EventNotes event={row} /> : <VisitLinks visit={row} />)}
    {phoneCalendarAvailable() && <View style={{ gap: 6 }}>
      <Button secondary icon="calendar-outline" title="Add to my phone’s calendar" onPress={() => void addToPhone()} />
      <Copy numeric kind="small" tone="muted">{phoneEventLine(row, shown, today)}</Copy>
    </View>}
    {asking === "edit" ? scopes : <Button secondary size="lg" icon="pencil-outline" title="Edit event" onPress={() => repeating ? setAsking("edit") : edit()} />}
    {asking === "delete" ? scopes : <Button variant="destructive" title="Delete event" onPress={() => repeating ? setAsking("delete") : Alert.alert("Delete this event?", appointment || visitQuestions(b.records, row.id).length + visitNotes(b.records, row.id).length > 0 ? "This removes it from your calendar. Its questions and notes stay in your Journal." : "This removes it from your calendar.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete event", style: "destructive", onPress: () => void remove(deleteAll, "Event removed.") },
    ])} />}
  </Screen>;
}
