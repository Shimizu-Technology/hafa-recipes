import { HealthNote } from "../components/health-note";
import { bodyLimit, overBy, tooLongWords } from "../lib/text-limits";
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { acceptableDay, dayOfRecord, milestoneInstant, milestones } from "@/lib/milestones";
import { messageFor } from "@/lib/models";
import { careWrite, logCare } from "@/lib/quick-care";
import { profileToday, timingChild, todayStage } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { dayKey, keyDate } from "@/lib/tracker";
import { canPreview } from "@/lib/weekly-content";
import { pendingRecords } from "@/lib/outbox";
import { recordedShots, shotLabel, visitEvent, visitOnCalendar, visitsFrom, visitsVisible, wellVisits, type WellVisit } from "@/lib/well-visits";
import { Button, Card, Copy, Empty, Field, Grouped, Notice, PressTarget, Row, Screen, Section, tap, useColors, useToast } from "@/components/ui";
import { ChildFilter } from "@/components/child-filter";
import { DateField } from "@/components/date-field";
import { Disclosure } from "@/components/disclosure";
import { MedicalSource } from "@/components/medical-source";
import { useMinuteClock } from "@/components/care-glance";

const dayName = (key: string) => keyDate(key).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

/**
 * AAP's visit ages, agent-reviewed for private family use, the shots a parent records, and both vaccine schedules as links.
 * The app says nothing about which vaccines are due, or whether a visit was missed.
 */
export default function WellVisits() {
  const b = useBaby(), c = useColors(), toast = useToast(), minute = useMinuteClock(),
    timeZone = b.state.bootstrap!.profile.timezone, today = profileToday(minute, timeZone), todayKey = dayKey(today),
    child = timingChild(b.state, today), childId = child?.id ?? null,
    // Notes and other custom logs share this kind, so every page is read: a shot must not fall off behind months of them.
    care = useTodayCare({ kinds: ["custom"], pages: 50, limit: 5000, poll: false, child: childId }),
    shots = recordedShots(care.all, childId),
    [preview, setPreview] = useState(false), visible = visitsVisible(preview),
    [adding, setAdding] = useState(false), [name, setName] = useState(""), [day, setDay] = useState(todayKey), [note, setNote] = useState("");
  const previewing = visible && !wellVisits.approved;
  async function saveShot() {
    if (!childId) return;
    if (!name.trim()) return toast("Add the shot’s name.");
    if (overBy(note, bodyLimit)) return toast(tooLongWords("note", overBy(note, bodyLimit)));
    if (!acceptableDay(day, child?.birth_date, todayKey)) return toast(`Choose a date from ${dayName(child?.birth_date ?? todayKey)} to today.`);
    const record = { ...careWrite("custom", childId, { label: shotLabel }, milestoneInstant(day, timeZone)), title: name.trim(), body: note.trim() };
    try {
      const undo = await logCare(b, record);
      tap("success");
      setAdding(false); setName(""); setNote(""); setDay(todayKey);
      toast("Shot saved.", { label: "Undo", onPress: async () => {
        try { await undo(); } catch (e) { toast(messageFor(e)); }
      } });
    } catch (e) { toast(messageFor(e)); }
  }
  async function addVisit(visit: WellVisit, visitDay: string) {
    if (!childId) return;
    const { title, child_id, occurred_at, data } = visitEvent(visit, childId, visitDay, timeZone);
    try {
      const undo = await logCare(b, { ...careWrite("event", child_id, data, occurred_at), title });
      tap("success");
      toast("Added to your calendar.", { label: "Undo", onPress: async () => {
        try { await undo(); } catch (e) { toast(messageFor(e)); }
      } });
    } catch (e) { toast(messageFor(e)); }
  }
  const notBorn = !child || todayStage(child, today) !== "baby",
    visits = !notBorn && visible ? visitsFrom(child.birth_date!, todayKey) : null;
  const visitRow = ({ visit, day: visitDay }: { visit: WellVisit; day: string }) => <View key={visit.id} style={{ backgroundColor: c.surface, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
    <Copy kind="label">{visit.title}</Copy>
    <Copy numeric kind="small" tone="muted">{visit.id === "3-5-days" ? "3 to 5 days after birth. Ask your baby’s doctor for the date." : `Around ${dayName(visitDay)}`}</Copy>
    {visit.id === "3-5-days" ? <Copy kind="small">Add the appointment your doctor gives you in Calendar.</Copy> : visitOnCalendar(pendingRecords(b.state), visit, childId)
      ? <Copy kind="small" tone="muted">On your calendar</Copy>
      : <Button secondary title="Add to calendar" onPress={() => void addVisit(visit, visitDay)} />}
  </View>;
  return <Screen title="Well visits & shots" subtitle={child?.name} back>
    <ChildFilter only={childId ?? undefined} />
    {notBorn ? <Empty icon="medkit-outline" title="These start after birth" body="Add the birth date in Settings when your baby arrives." /> : <>
      <Section title="Well visits">
        {canPreview() && !wellVisits.approved && <PressTarget accessibilityRole="button" onPress={() => setPreview(!preview)}
          accessibilityLabel={`Development only: ${preview ? "hide" : "preview"} unreviewed visits`}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: c.outline }}>
          <Copy kind="small">{`Development only: ${preview ? "hide" : "preview"} unreviewed visits`}</Copy>
        </PressTarget>}
        {visits ? <View style={{ gap: 12 }}>
          {previewing && <Copy kind="label" tone="error">Development only. Not reviewed by a doctor.</Copy>}
          <Copy kind="small" tone="muted">Dates are counted from the birth date. Your baby’s doctor sets the real schedule.</Copy>
          {!!visits.upcoming.length && <Grouped separatorInset={16}>{visits.upcoming.map(visitRow)}</Grouped>}
          {!!visits.past.length && <Disclosure title="Earlier ages"><Grouped separatorInset={16}>{visits.past.map(visitRow)}</Grouped></Disclosure>}
          <MedicalSource source="American Academy of Pediatrics, well-child visits" url={wellVisits.source.url} />
        </View> : <Copy kind="small" tone="muted">Visit suggestions are unavailable. Your baby’s doctor sets the schedule.</Copy>}
      </Section>
      <Section title="Shots">
        {!!care.error && <Notice>Showing what’s on this phone. {care.error}</Notice>}
        {adding ? <Card style={{ gap: 12 }}>
          <Field label="Which shot" value={name} onChange={setName} maxLength={120} autoFocus />
          <DateField dateOnly label="Date" value={day} onChange={setDay} />
          <Field label="Note (optional)" value={note} onChange={setNote} multiline />
          <Button title="Save shot" onPress={() => void saveShot()} />
          <Button secondary title="Cancel" onPress={() => setAdding(false)} />
        </Card> : <Button secondary title="Record a shot" onPress={() => setAdding(true)} />}
        {shots.length ? <Grouped>
          {shots.map((row) => <Row key={row.id} numericDetail title={row.title} detail={dayName(dayOfRecord(row, timeZone))} icon="medkit-outline"
            onPress={() => router.push({ pathname: "/record/[id]", params: { id: row.id } })} />)}
        </Grouped> : !adding && <Copy kind="small" tone="muted">Shots you record show up here, and on that day in Tracker.</Copy>}
      </Section>
      <Section title="Vaccine schedules">
        {wellVisits.approved && <Copy kind="small">AAP and CDC publish vaccine schedules. Recommendations can change or differ. Ask your baby’s doctor what’s due.</Copy>}
        <MedicalSource source={wellVisits.vaccine_links.aap.name} url={wellVisits.vaccine_links.aap.url} />
        <MedicalSource source={wellVisits.vaccine_links.cdc.name} url={wellVisits.vaccine_links.cdc.url} />
        <Copy kind="small">{milestones.non_endorsement}</Copy>
      </Section>
    </>}
    <HealthNote />
  </Screen>;
}
