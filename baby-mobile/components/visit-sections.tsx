import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { eventWhen } from "@/lib/events";
import { messageFor, type BabyRecord, type EventOccurrence } from "@/lib/models";
import { useUpcomingEvents } from "@/lib/use-events";
import { useVisitEvent, useVisitRecords } from "@/lib/use-visit";
import { fitsVisit, heldDrafts, holdDraft, heldChoices, holdChoice, looseQuestions, nextAppointment, questionWords, visitNotes, visitQuestions, visitCapture, visitIsSeries, visitReturn } from "@/lib/visits";
import { dayKey } from "@/lib/tracker";
import { profileToday } from "@/lib/timing";
import { Button, Choice, Copy, Field, Grouped, Notice, Row, tap, useToast } from "./ui";
import { kindIcon } from "./record-row";

type Visit = Pick<BabyRecord, "id" | "child_id"> & Partial<Pick<BabyRecord, "title" | "space_id" | "occurred_at" | "data">> & { repeats?: boolean; return_at?: string };
const openRecord = (row: BabyRecord, visit: { id: string }, at?: string) => router.push({ pathname: "/record/[id]", params: { id: row.id, fromVisit: visit.id, ...(at ? { visitAt: at } : {}) } });
import { addMutation } from "../lib/outbox";
import { generationOf } from "../lib/spaces";
const useVisitAt = (visit: { occurred_at?: string; return_at?: string }) => useLocalSearchParams<{ at?: string }>().at ?? visit.return_at ?? visit.occurred_at;

/** What's half-typed, for each visit and baby. Held above the box, so it's still there after a baby with no appointment. */
export function useVisitDrafts() {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  return { typed, write: (target: string, text: string) => setTyped((held) => ({ ...held, [target]: text })), choices, choose: (target: string, shared: boolean) => setChoices((held) => ({ ...held, [target]: shared })) };
}
/** The same on an appointment's own screen, so leaving it for a moment doesn't lose her words. */
function useHeldDrafts(key: string) {
  const [typed, setTyped] = useState(() => heldDrafts(key));
  const [choices, setChoices] = useState(() => heldChoices(key));
  return { typed, write: (target: string, text: string) => setTyped(holdDraft(key, target, text)), choices, choose: (target: string, shared: boolean) => setChoices(holdChoice(key, target, shared)) };
}
const draftTarget = ({ id, child_id }: Visit) => `${id}:${child_id ?? ""}`;
/**
 * A box and a button that saves what's in it, offline too, and clears for the next one. Its words belong to `target`:
 * when the baby changes the box is another one, and what's saved goes where it was typed, wherever the screen has moved on to.
 */
function QuickAdd({ target, drafts, label, action, placeholder, multiline, save }: { target: string; drafts: ReturnType<typeof useVisitDrafts>; label: string; action: string; placeholder: string; multiline?: boolean; save: (text: string) => Promise<void> }) {
  const { typed, write } = drafts, text = typed[target] ?? "", [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), error = errors[target];
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
/** A choice lives with its words and stays for the next entry until she returns to an empty box. */
function VisitCapture({ visit, kind, drafts }: { visit: Visit; kind: "question" | "journal"; drafts?: ReturnType<typeof useVisitDrafts> }) {
  const b = useBaby(), toast = useToast(), own = useVisitDrafts(), words = drafts ?? own, current = useRef(words), target = draftTarget(visit), defaultShared = kind === "question", chosen = words.choices[target] ?? defaultShared, setShared = (value: boolean) => words.choose(target, value),
    event = b.records.find((row) => row.id === visit.id) ?? visit,
    family = b.state.bootstrap?.spaces?.find((one) => one.id === event.space_id && one.kind === "family"), series = visit.repeats ?? !!event.data?.recurrence, shared = family?.role === "caregiver" ? false : chosen;
  current.current = words;
  useEffect(() => { if (family?.role === "caregiver") current.current.choose(target, false); }, [family?.role, target]);
  useFocusEffect(useCallback(() => { if (!current.current.typed[target]?.trim()) current.current.choose(target, defaultShared); }, [target, defaultShared]));
  if (kind === "question" && family?.role === "caregiver") return null;
  return <View style={{ gap: 8 }}>
    {kind === "journal" && <Copy kind="small" tone="muted">Your own words in Journal. Private unless you choose to share.</Copy>}
    {family && <>
      {family.role === "parent" && <>
        <Choice label="Keep to myself" selected={!shared} onPress={() => setShared(false)} />
        <Choice label={series ? "Share with the family in this series" : "Share with the family on this visit"} selected={shared} onPress={() => setShared(true)} />
      </>}
      {shared && <Copy kind="small" tone="muted">{series ? "Shared with family in this series." : "Shared with family on this visit."}</Copy>}
      {!shared && <Copy kind="small" tone="muted">{`This will stay in your Journal, on the visit’s day. It won’t be attached to the shared ${series ? "series" : "visit"}.`}</Copy>}
    </>}
    <QuickAdd target={draftTarget(visit)} drafts={words} multiline={kind === "journal"}
      label={kind === "journal" ? "In your words" : "Add a question for the doctor"}
      action={kind === "journal" ? "Save this note" : "Add question"}
      placeholder={kind === "journal" ? "Write it here" : "What do you want to ask?"}
      save={async (text) => {
        const id = Crypto.randomUUID(), change = Crypto.randomUUID(); let privateNote = false;
        await b.commit((state) => {
          const record = visitCapture(state, id, kind, text, visit, shared),
            space = record.data.just_me ? state.bootstrap!.personal_space_id : (state.records.find((row) => row.id === visit.id)?.space_id ?? visit.space_id);
          privateNote = !!record.data.just_me;
          return addMutation(state, { id: change, generation: generationOf(state.bootstrap, space) ?? state.bootstrap!.generation, space_id: space, type: "save", record, files: [] });
        });
        toast(privateNote ? `Saved on this phone in Journal. Not attached to the shared ${series ? "series" : "visit"}.` : "Saved on this phone. Waiting to sync.");
        void b.sync();
      }} />
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
  const b = useBaby(), rows = visitQuestions(b.records, visit.id), shown = limit ? rows.slice(0, limit) : rows, whose = useWhose(visit), at = useVisitAt(visit), series = visitIsSeries(visit, b.records);
  return <View style={{ gap: 10 }}>
    {shown.length > 0 && <Grouped>{shown.map((row) => <Row key={row.id} title={questionWords(row)} detail={[whose(row), series && "Appointment series"].filter(Boolean).join(" · ") || undefined} icon={kindIcon.question} onPress={() => openRecord(row, visit, at)} />)}</Grouped>}
    {rows.length > shown.length && <Copy kind="small" tone="muted">{`And ${rows.length - shown.length} more`}</Copy>}
    <VisitCapture visit={visit} kind="question" drafts={drafts} />
  </View>;
}
/** Everything about the visit itself, on the appointment's own screen. */
export function VisitSections({ visit }: { visit: Visit }) {
  const b = useBaby(), toast = useToast(), at = useVisitAt(visit), returnAt = at, series = visitIsSeries(visit, b.records), notes = visitNotes(b.records, visit.id), loose = looseQuestions(b.records, visit), whose = useWhose(visit),
    questionDrafts = useHeldDrafts(`${b.owner}:question`), noteDrafts = useHeldDrafts(`${b.owner}:note`);
  useVisitRecords(visit.id, true);
  return <>
    <View style={{ gap: 10 }}>
      <Copy kind="heading">{series ? "Questions for this appointment series" : "Questions for the doctor"}</Copy>
      {series && <Copy kind="small" tone="muted">Questions and notes belong to every date in this series.</Copy>}
      <VisitQuestions visit={visit} drafts={questionDrafts} />
      <Grouped><Row title="Doctor summary" detail="One page with your questions, notes and daily totals" icon="document-text-outline"
        onPress={() => router.push({ pathname: "/doctor-summary", params: { child: visit.child_id ?? undefined, visit: visit.id, visitTitle: visit.title, at: visit.occurred_at, visitAt: returnAt, series: visit.data?.recurrence ? "1" : undefined, allDay: visit.data?.all_day ? "1" : undefined, eventZone: visit.data?.timezone } })} /></Grouped>
    </View>
    {loose.length > 0 && <View style={{ gap: 10 }}>
      <Copy kind="label">Saved questions</Copy>
      <Grouped>{loose.map((row) => <Row key={row.id} title={questionWords(row)} detail={[whose(row), series ? "Tap to add to this series" : "Tap to add to this visit"].filter(Boolean).join(" · ")} icon="add-circle-outline"
        onPress={() => void b.queue(linked(b, row, visit.id)).then(() => toast(series ? "Added to this series." : "Added to this visit.")).catch((e) => toast(messageFor(e)))} />)}</Grouped>
    </View>}
    <View style={{ gap: 10 }}>
      <Copy kind="heading">What the doctor said</Copy>
      {notes.length > 0 && <Grouped>{notes.map((row) => <Row key={row.id} title={questionWords(row)} icon={kindIcon.journal} onPress={() => openRecord(row, visit, at)} />)}</Grouped>}
      <VisitCapture visit={visit} kind="journal" drafts={noteDrafts} />
    </View>
    {b.records.find((row) => row.id === visit.id && row.kind === "event") && <EventNotes event={b.records.find((row) => row.id === visit.id)!} />}
  </>;
}
/** What's already on an event that's no longer an appointment. Changing its category doesn't take her words away. */
export function VisitLinks({ visit }: { visit: Pick<BabyRecord, "id"> & Partial<Pick<BabyRecord, "data" | "occurred_at">> }) {
  const b = useBaby(), at = useVisitAt(visit), series = visitIsSeries(visit, b.records), questions = visitQuestions(b.records, visit.id), notes = visitNotes(b.records, visit.id);
  useVisitRecords(visit.id, true);
  return <>
    {b.records.find((row) => row.id === visit.id && row.kind === "event") && <EventNotes event={b.records.find((row) => row.id === visit.id)!} />}
    {series && notes.length > 0 && <Copy kind="small" tone="muted">These notes belong to the appointment series.</Copy>}
    {questions.length > 0 && <View style={{ gap: 10 }}>
      <Copy kind="heading">{series ? "Questions for this appointment series" : "Questions for the doctor"}</Copy>
      <Grouped>{questions.map((row) => <Row key={row.id} title={questionWords(row)} icon={kindIcon.question} onPress={() => openRecord(row, visit, at)} />)}</Grouped>
    </View>}
    {notes.length > 0 && <View style={{ gap: 10 }}>
      <Copy kind="heading">What the doctor said</Copy>
      <Grouped>{notes.map((row) => <Row key={row.id} title={questionWords(row)} icon={kindIcon.journal} onPress={() => openRecord(row, visit, at)} />)}</Grouped>
    </View>}
  </>;
}
function linked(b: ReturnType<typeof useBaby>, row: BabyRecord, eventId: string | null) {
  const prior = [...b.state.outbox].reverse().find((m) => m.type === "save" && m.record.id === row.id);
  return { id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save" as const, record: { ...row, data: { ...row.data, event_id: eventId } }, files: prior?.type === "save" ? prior.files : [] };
}
const useToday = () => {
  const zone = useBaby().state.bootstrap?.profile.timezone;
  return dayKey(profileToday(new Date(), zone));
};
/** On Today: the next appointment's questions, under the next event, which may be something else. */
export function NextVisitQuestions({ items, separate, drafts }: { items: readonly EventOccurrence[]; separate?: boolean; drafts?: ReturnType<typeof useVisitDrafts> }) {
  const b = useBaby(), own = useVisitDrafts(), timeZone = b.state.bootstrap?.profile.timezone, today = useToday(), visit = nextAppointment(items, new Date(), timeZone), event = useVisitEvent(visit?.event_id).event;
  useVisitRecords(visit?.event_id);
  if (!visit || !event) return null;
  return <View style={{ gap: 8 }}>
    {separate && <Copy numeric kind="small" tone="muted">{`Questions for ${visit.title}, ${eventWhen(visit, today, timeZone)}`}</Copy>}
    <VisitQuestions visit={{ id: visit.event_id, child_id: visit.child_id, occurred_at: visit.occurrence_start, return_at: visit.original_start, repeats: visit.repeats, space_id: event.space_id, data: { ...event.data, all_day: visit.all_day, timezone: visit.timezone } }} limit={3} drafts={drafts ?? own} />
  </View>;
}
/** In Journal: every saved question onto the next appointment, in one tap. They stay in Journal too. */
export function LinkQuestions({ rows }: { rows: readonly BabyRecord[] }) {
  const b = useBaby(), toast = useToast(), today = useToday(), timeZone = b.state.bootstrap?.profile.timezone, { items } = useUpcomingEvents(b.state.selectedChild, today),
    visit = nextAppointment(items, new Date(), timeZone), event = useVisitEvent(visit?.event_id).event, target = visit && event ? { ...visit, space_id: event.space_id } : undefined, loose = looseQuestions(rows, target);
  if (!visit || !event || !loose.length) return null;
  const count = loose.length === 1 ? "this question" : `these ${loose.length} questions`;
  return <Row numericDetail icon="link-outline" title={`Add ${count} to ${visit.title}${visit.repeats ? " series" : ""}`} detail={visit.repeats ? "Every date in this appointment series" : eventWhen(visit, today, timeZone)} onPress={() => void (async () => {
    for (const row of loose) await b.queue(linked(b, row, visit.event_id));
    tap("success");
    toast(`Added to ${visit.title}${visit.repeats ? " series" : ""}.`);
  })().catch((e) => toast(messageFor(e)))} />;
}
/** On a question or note: the visit it's for, or one tap onto the next appointment. */
export function RecordVisit({ record }: { record: BabyRecord }) {
  const params = useLocalSearchParams<{ fromVisit?: string; visitAt?: string }>();
  const b = useBaby(), toast = useToast(), today = useToday(), timeZone = b.state.bootstrap?.profile.timezone, { items } = useUpcomingEvents(record.child_id, today),
    eventId = record.data.event_id as string | null | undefined, visit = nextAppointment(items, new Date(), timeZone), resolution = useVisitEvent(eventId ?? (record.kind === "question" ? visit?.event_id : undefined)), resolved = resolution.event, unavailable = resolution.unavailable, event = eventId ? resolved : undefined,
    change = (id: string | null, message: string) => void b.queue(linked(b, record, id)).then(() => toast(message)).catch((e) => toast(messageFor(e)));
  const series = !!event?.data.recurrence;
  if (eventId) return <Grouped>
    {unavailable && !event ? <Copy kind="small" tone="muted">Appointment unavailable. Your note stays in Journal.</Copy> : <Row title={event ? `For ${event.title}${series ? " · Series" : ""}` : "Linked appointment"} detail={series ? "Belongs to the appointment series" : event?.data.category === "appointment" ? "Open appointment" : "Open event"} icon="calendar-outline" onPress={() => router.push({ pathname: "/event/[id]", params: visitReturn(eventId, params.fromVisit, params.visitAt) })} />}
    {record.kind === "question" && <Row title={series ? "Take off this series" : "Take off this visit"} detail="It stays in Journal" icon="remove-circle-outline" onPress={() => change(null, series ? "Taken off this series." : "Taken off this visit.")} />}
  </Grouped>;
  return record.kind === "question" && visit && resolved && fitsVisit(record, { ...visit, space_id: resolved.space_id }) ? <Row numericDetail title={`Add to ${visit.title}${visit.repeats ? " series" : ""}`} detail={visit.repeats ? "Every date in this appointment series" : eventWhen(visit, today, timeZone)} icon="link-outline" onPress={() => change(visit.event_id, `Added to ${visit.title}${visit.repeats ? " series" : ""}.`)} /> : null;
}

/** Ordinary event notes use Journal's existing photo editor and never imply clinician instructions. */
export function EventNotes({ event }: { event: BabyRecord }) {
  const b = useBaby(), toast = useToast(), [shared, setShared] = useState(false);
  useVisitRecords(event.id, true);
  const notes = b.records.filter((row) => row.kind === "journal" && row.data.event_id === event.id && row.data.provenance !== "clinician_instruction");
  async function write() {
    const id = Crypto.randomUUID(), slot = `event-note:${id}`;
    try {
      await b.commit((state) => {
        const record = visitCapture(state, id, "journal", "", event, shared), space = record.data.just_me ? state.bootstrap!.personal_space_id : event.space_id;
        return { ...state, drafts: { ...state.drafts, [slot]: { ...record, files: [], shared, ...(space ? { space_id: space, generation: generationOf(state.bootstrap, space) ?? state.bootstrap!.generation } : {}), data: { ...record.data, provenance: "caregiver_observation" as const } } } };
      });
      router.push({ pathname: "/edit", params: { draft: slot, kind: "journal" } });
    } catch (e) { toast(messageFor(e)); }
  }
  return <View style={{ gap: 10 }}>
    <Copy kind="heading">Notes & handouts</Copy>
    <Copy kind="small" tone="muted">Your words and photos in Journal. Class material is saved by you, without creating instructions or reminders. Private notes on shared events stay in Journal without a family link.</Copy>
    {b.state.bootstrap?.spaces?.some((space) => space.id === event.space_id && space.kind === "family" && space.role === "parent") && <Choice label="Share this new note with the family on this event" selected={shared} onPress={() => setShared(!shared)} />}
    <Grouped>{notes.map((row) => <Row key={row.id} title={questionWords(row)} icon="document-text-outline" onPress={() => openRecord(row, event, event.occurred_at)} />)}
      <Row title="Write a note or add photos" icon="add-outline" onPress={() => void write()} /></Grouped>
  </View>;
}
