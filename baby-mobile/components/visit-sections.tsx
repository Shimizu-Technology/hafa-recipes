import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { eventWhen } from "@/lib/events";
import { messageFor, type BabyRecord, type EventOccurrence, type RecordWrite } from "@/lib/models";
import { useUpcomingEvents } from "@/lib/use-events";
import { useVisitRecords } from "@/lib/use-visit";
import { fitsVisit, looseQuestions, newQuestion, newVisitNote, nextAppointment, questionWords, visitNotes, visitQuestions } from "@/lib/visits";
import { dayKey } from "@/lib/tracker";
import { profileToday } from "@/lib/timing";
import { Button, Copy, Field, Grouped, Notice, Row, tap, useToast } from "./ui";
import { kindIcon } from "./record-row";

type Visit = Pick<BabyRecord, "id" | "child_id">;
const openRecord = (row: BabyRecord) => router.push({ pathname: "/record/[id]", params: { id: row.id } });
const queueWrite = (b: ReturnType<typeof useBaby>, record: RecordWrite) => b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", record, files: [] });

/** What's half-typed, for each visit and baby. Held above the box, so it's still there after a baby with no appointment. */
export function useVisitDrafts() {
  const [typed, setTyped] = useState<Record<string, string>>({});
  return { typed, write: (target: string, text: string) => setTyped((held) => ({ ...held, [target]: text })) };
}
const draftTarget = ({ id, child_id }: Visit) => `${id}:${child_id ?? ""}`;
/**
 * A box and a button that saves what's in it, offline too, and clears for the next one. Its words belong to `target`:
 * when the baby changes the box is another one, and what's saved goes where it was typed, wherever the screen has moved on to.
 */
function QuickAdd({ target, drafts, label, action, placeholder, multiline, save }: { target: string; drafts?: ReturnType<typeof useVisitDrafts>; label: string; action: string; placeholder: string; multiline?: boolean; save: (text: string) => Promise<void> }) {
  const own = useVisitDrafts(), { typed, write } = drafts ?? own, text = typed[target] ?? "", [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), error = errors[target];
  async function add() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErrors((held) => ({ ...held, [target]: "" }));
    try { await save(text); tap("success"); write(target, ""); } catch (e) { setErrors((held) => ({ ...held, [target]: messageFor(e) })); } finally { setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    {!!error && <Notice error>{error}</Notice>}
    <Field key={target} label={label} value={text} onChange={(words) => write(target, words)} placeholder={placeholder} multiline={multiline} maxLength={multiline ? 4000 : 1000} onSubmit={multiline ? undefined : () => void add()} returnKeyType={multiline ? undefined : "done"} />
    <Button secondary size="lg" icon="add" title={action} disabled={!text.trim()} busy={busy} onPress={() => void add()} />
  </View>;
}
/** A family visit holds questions about each baby, so it says whose each one is. */
function useWhose(visit: Visit) {
  const children = useBaby().state.bootstrap?.children ?? [];
  return (row: BabyRecord) => {
    const name = !visit.child_id && row.child_id ? children.find((child) => child.id === row.child_id)?.name : undefined;
    return name ? `For ${name}` : undefined;
  };
}
/** Her questions for one visit, and a way to add another without leaving where she is. */
export function VisitQuestions({ visit, limit, drafts }: { visit: Visit; limit?: number; drafts?: ReturnType<typeof useVisitDrafts> }) {
  const b = useBaby(), rows = visitQuestions(b.records, visit.id), shown = limit ? rows.slice(0, limit) : rows, whose = useWhose(visit);
  return <View style={{ gap: 10 }}>
    {shown.length > 0 && <Grouped>{shown.map((row) => <Row key={row.id} title={questionWords(row)} detail={whose(row)} icon={kindIcon.question} onPress={() => openRecord(row)} />)}</Grouped>}
    {rows.length > shown.length && <Copy kind="small" tone="muted">{`And ${rows.length - shown.length} more`}</Copy>}
    <QuickAdd target={draftTarget(visit)} drafts={drafts} label="Add a question for the doctor" action="Add question" placeholder="What do you want to ask?" save={(text) => queueWrite(b, newQuestion(Crypto.randomUUID(), text, visit))} />
  </View>;
}
/** Everything about the visit itself, on the appointment's own screen. */
export function VisitSections({ visit }: { visit: Visit }) {
  const b = useBaby(), toast = useToast(), notes = visitNotes(b.records, visit.id), loose = looseQuestions(b.records, visit), whose = useWhose(visit);
  useVisitRecords(visit.id, true);
  return <>
    <View style={{ gap: 10 }}>
      <Copy kind="heading">Questions for the doctor</Copy>
      <VisitQuestions visit={visit} />
    </View>
    {loose.length > 0 && <View style={{ gap: 10 }}>
      <Copy kind="label">Saved questions</Copy>
      <Grouped>{loose.map((row) => <Row key={row.id} title={questionWords(row)} detail={[whose(row), "Tap to add to this visit"].filter(Boolean).join(" · ")} icon="add-circle-outline"
        onPress={() => void b.queue(linked(b, row, visit.id)).then(() => toast("Added to this visit.")).catch((e) => toast(messageFor(e)))} />)}</Grouped>
    </View>}
    <View style={{ gap: 10 }}>
      <Copy kind="heading">What the doctor said</Copy>
      {notes.length > 0 && <Grouped>{notes.map((row) => <Row key={row.id} title={questionWords(row)} icon={kindIcon.journal} onPress={() => openRecord(row)} />)}</Grouped>}
      <QuickAdd target={draftTarget(visit)} multiline label="In your words" action="Save this note" placeholder="Write it here" save={(text) => queueWrite(b, newVisitNote(Crypto.randomUUID(), text, visit))} />
    </View>
  </>;
}
function linked(b: ReturnType<typeof useBaby>, row: BabyRecord, eventId: string | null) {
  return { id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save" as const, record: { ...row, data: { ...row.data, event_id: eventId } }, files: [] };
}
const useToday = () => {
  const zone = useBaby().state.bootstrap?.profile.timezone;
  return dayKey(profileToday(new Date(), zone));
};
/** On Today: the next appointment's questions, under the next event, which may be something else. */
export function NextVisitQuestions({ items, separate, drafts }: { items: readonly EventOccurrence[]; separate?: boolean; drafts?: ReturnType<typeof useVisitDrafts> }) {
  const b = useBaby(), timeZone = b.state.bootstrap?.profile.timezone, today = useToday(), visit = nextAppointment(items, new Date(), timeZone);
  useVisitRecords(visit?.event_id);
  if (!visit) return null;
  return <View style={{ gap: 8 }}>
    {separate && <Copy numeric kind="small" tone="muted">{`Questions for ${visit.title}, ${eventWhen(visit, today, timeZone)}`}</Copy>}
    <VisitQuestions visit={{ id: visit.event_id, child_id: visit.child_id }} limit={3} drafts={drafts} />
  </View>;
}
/** In Journal: every saved question onto the next appointment, in one tap. They stay in Journal too. */
export function LinkQuestions({ rows }: { rows: readonly BabyRecord[] }) {
  const b = useBaby(), toast = useToast(), today = useToday(), timeZone = b.state.bootstrap?.profile.timezone, { items } = useUpcomingEvents(b.state.selectedChild, today),
    visit = nextAppointment(items, new Date(), timeZone), loose = looseQuestions(rows, visit);
  if (!visit || !loose.length) return null;
  const count = loose.length === 1 ? "this question" : `these ${loose.length} questions`;
  return <Row numericDetail icon="link-outline" title={`Add ${count} to ${visit.title}`} detail={eventWhen(visit, today, timeZone)} onPress={() => void (async () => {
    for (const row of loose) await b.queue(linked(b, row, visit.event_id));
    tap("success");
    toast(`Added to ${visit.title}.`);
  })().catch((e) => toast(messageFor(e)))} />;
}
/** On a question or note: the visit it's for, or one tap onto the next appointment. */
export function RecordVisit({ record }: { record: BabyRecord }) {
  const b = useBaby(), toast = useToast(), today = useToday(), timeZone = b.state.bootstrap?.profile.timezone, { items } = useUpcomingEvents(record.child_id, today),
    eventId = record.data.event_id as string | null | undefined, event = eventId ? b.records.find((row) => row.id === eventId && row.kind === "event") : undefined, visit = nextAppointment(items, new Date(), timeZone),
    change = (id: string | null, message: string) => void b.queue(linked(b, record, id)).then(() => toast(message)).catch((e) => toast(messageFor(e)));
  if (eventId) return <Grouped>
    <Row title={`For ${event?.title ?? "an appointment"}`} detail="Open this visit" icon="calendar-outline" onPress={() => router.push({ pathname: "/event/[id]", params: { id: eventId } })} />
    {record.kind === "question" && <Row title="Take off this visit" detail="It stays in Journal" icon="remove-circle-outline" onPress={() => change(null, "Taken off this visit.")} />}
  </Grouped>;
  return record.kind === "question" && visit && fitsVisit(record, visit) ? <Row numericDetail title={`Add to ${visit.title}`} detail={eventWhen(visit, today, timeZone)} icon="link-outline" onPress={() => change(visit.event_id, `Added to ${visit.title}.`)} /> : null;
}
