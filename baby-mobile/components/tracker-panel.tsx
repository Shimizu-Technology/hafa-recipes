import { useEffect, useRef, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { careWrite, logCare, pumpStart, pumpStep, type BottleChoice } from "@/lib/quick-care";
import { friendlyTime, timeAgo } from "@/lib/care-format";
import { dataFrom, feelingWords, lastDose, lastLog, logTitle, noteLabel, recentCustomLabels, recentMedicines, recentVitamins, startForm, type LogForm } from "@/lib/more-logs";
import type { Tracker } from "@/lib/trackers";
import { messageFor, type Child, type RecordData } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { Button, Field, KeyboardSave, OnSurface, tap, typeScale, useColors } from "./ui";
import { LogFields, sideWords } from "./log-fields";
import { AmountStepper, Option, Panel, SavedRow, keepPlace, usePlaceBackOnLeaving, type useLogFlow } from "./quick-log";
import type { PastDay } from "./quick-time";
import { babyLabel } from "../lib/spaces";

type Flow = ReturnType<typeof useLogFlow<string>>;
type PanelProps = Omit<React.ComponentProps<typeof Panel>, "title" | "detail" | "children">;

/** A time ahead of the clock can't have happened, so it means now. */
const notAhead = (iso: string | null) => (iso && new Date(iso).getTime() > Date.now() ? null : iso);

/** What just saved, with Undo, wherever the panel was opened from. */
export function SavedLog({ flow, now, day, timeZone }: { flow: Flow; now: Date; day?: PastDay; timeZone?: string | null }) {
  const { saved, setSaved, panel, amend, undo } = flow;
  usePlaceBackOnLeaving(setSaved);
  return saved ? <SavedRow key={saved.key} saved={saved} compact={!!panel} now={now} day={day} timeZone={timeZone} onUndo={() => void undo()}
    // The tiles sit right under this one.
    onGone={() => setSaved(keepPlace(saved))}
    onMove={(iso) => { const moved = notAhead(iso) ?? new Date().toISOString(); setSaved({ ...saved, at: moved }); amend(() => ({ occurred_at: moved })); }}
    onColor={() => undefined} onNote={(body) => amend((row) => (row.body === body ? {} : { body }))} /> : null;
}

/** Fields and a Save, for what can't be one tap. A wrong entry is said here and nothing is queued. */
function FormPanel({ id, title, detail, start, panelProps, autoFocus, children, offers, hint, saveAs }: { id: string; title: string; detail?: string; start: LogForm; autoFocus?: boolean; children?: React.ReactNode;
  /** What she can fill the form with in one tap. Save still records it. */
  offers?: (form: LogForm, fill: (change: Partial<LogForm>) => void) => React.ReactNode;
  /** A line under the fields that follows what she's typing. */
  hint?: (form: LogForm) => string | undefined;
  panelProps: PanelProps; saveAs: (form: LogForm) => void }) {
  // Follows `start` until she changes something, since what she last used can arrive after the panel opens.
  const c = useColors(), { fontScale } = useWindowDimensions(), [typed, setTyped] = useState<LogForm | null>(null), [problem, setProblem] = useState(""), [fills, setFills] = useState(0), form = typed ?? start,
    label = `Save ${title.toLowerCase()}`, onSave = () => { try { saveAs(form); } catch (e) { setProblem(messageFor(e)); } },
    // A new key, since the fields hold what she has typed and this replaces it.
    fill = (change: Partial<LogForm>) => { tap(); setTyped({ ...form, ...change }); setProblem(""); setFills(fills + 1); };
  return <Panel title={title} detail={detail} {...panelProps}>
    {children}
    {offers?.(form, fill)}
    <OnSurface><KeyboardSave.Provider value={{ label, onPress: onSave }}><LogFields key={fills} id={id} start={form} autoFocus={autoFocus} onChange={(next) => { setTyped(next); setProblem(""); }} /></KeyboardSave.Provider></OnSurface>
    {!!hint?.(form) && <Text key={`h:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.muted }}>{hint(form)}</Text>}
    {!!problem && <Text accessibilityLiveRegion="polite" key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText }}>{problem}</Text>}
    <Button size="lg" icon="checkmark" title="Save" accessibilityLabel={label} onPress={onSave} />
  </Panel>;
}

/** What the API holds at most. */
const pumpMost = 10000;
/** The amount from last time, stepped or typed, and a side. Choosing a side saves it. */
function PumpPanel({ start, detail, panelProps, onSave }: { start: BottleChoice; detail?: string; panelProps: PanelProps; onSave: (side: keyof typeof sideWords, amount: Pick<BottleChoice, "amount" | "unit">) => void }) {
  // Follows `start` until she changes it, since the last amount can arrive after the panel opens.
  const [changed, setAmount] = useState<Pick<BottleChoice, "amount" | "unit"> | null>(null), amount = changed ?? { amount: start.amount, unit: start.unit },
    same = start.fromLast && amount.amount === start.amount && amount.unit === start.unit,
    [empty, setEmpty] = useState(false), c = useColors(), { fontScale } = useWindowDimensions();
  return <Panel title="Pumping" detail={detail} {...panelProps}>
    <AmountStepper typing amount={amount} onChange={(next) => { setAmount(next); setEmpty(false); }} steps={pumpStep} note={same ? "Same as last time" : undefined} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(["left", "right", "both"] as const).map((side) => <Option key={side} height={64} label={sideWords[side]} onPress={() => { if (amount.amount > 0 && amount.amount <= pumpMost) onSave(side, amount); else setEmpty(true); }} />)}
    </View>
    {empty && <Text accessibilityLiveRegion="polite" key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText }}>Enter the amount first.</Text>}
  </Panel>;
}

function NotePanel({ detail, panelProps, onSave }: { detail?: string; panelProps: PanelProps; onSave: (text: string) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [note, setNote] = useState(""), [empty, setEmpty] = useState(false),
    onPress = () => { const text = note.trim(); setEmpty(!text); if (text) onSave(text); };
  return <Panel title="Note" detail={detail} {...panelProps}>
    <OnSurface><KeyboardSave.Provider value={{ label: "Save note", onPress }}><Field multiline label="What to remember" value={note} autoFocus onChange={(text) => { setNote(text); setEmpty(false); }} /></KeyboardSave.Provider></OnSurface>
    {empty && <Text accessibilityLiveRegion="polite" key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText }}>Write the note first.</Text>}
    <Button size="lg" icon="checkmark" title="Save" accessibilityLabel="Save note" onPress={onPress} />
  </Panel>;
}

/** The panel's "Last" is only as good as the last look, so she hears when that didn't get through. */
function OnThisPhone() {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <Text accessibilityLiveRegion="polite" key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText }}>Showing what’s on this phone. Anything logged on another phone may be missing.</Text>;
}

const Choices = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;

type TrackerPanelProps = { tracker: Tracker; child: Child; now: Date; pastDay?: PastDay; flow: Flow };
/**
 * One tracker's quick panel, as quick as a diaper: the time defaults to now, nothing goes back anywhere, and it works
 * offline. It only needs a `useLogFlow`, so it opens the same from Today, Tracker or Add. Show `SavedLog` beside it for Undo.
 *
 * What's typed belongs to the baby it was typed for. `MoreLogs` closes the panel when the baby changes; this starts it again
 * wherever it stays open, so a dose can't land on the other baby. A log about her isn't either baby's, so it carries on.
 */
export function TrackerPanel(props: TrackerPanelProps) {
  const owner = props.tracker.about === "her" ? "her" : props.child.id, was = useRef(owner);
  useEffect(() => {
    if (was.current !== owner) { was.current = owner; props.flow.change(null); }
  }, [owner]);
  return <PanelFor key={`${props.tracker.id}:${owner}`} {...props} />;
}

function PanelFor({ tracker, child, now, pastDay, flow }: TrackerPanelProps) {
  const b = useBaby(), timeZone = b.state.bootstrap!.profile.timezone, id = tracker.id,
    // What she logs about herself has no baby on it, and stays with her.
    childId = tracker.about === "her" ? null : child.id,
    // Only this kind, so another kind's logs can't push a dose out of reach, and it keeps looking while the panel is open.
    care = useTodayCare({ kinds: [tracker.kind], poll: true, child: child.id }), rows = care.all,
    behind = !!care.error || !!care.stale || b.online === false,
    // A dose on the wrong baby would make both babies' Last wrong, so with two she can see which this is.
    baby = tracker.about === "baby" && b.state.bootstrap!.children.length > 1 ? babyLabel(child, b.state.bootstrap) : "",
    who = baby ? `For ${baby}` : undefined,
    panelProps = { at: flow.at, now, day: pastDay, timeZone, needTime: flow.needTime, onTime: (iso: string | null) => flow.change(notAhead(iso)) },
    // Kept whole, so a narrow chip can't leave "3" on one line and "h ago" on the next.
    lastWords = (at: string) => `Last ${friendlyTime(at, now, timeZone)} · ${timeAgo(at, now).replace(/ /g, "\u00a0")}`;
  function log(data: RecordData, title: string, label: string, body = "") {
    const time = flow.when();
    if (!time) return;
    const record = { ...careWrite(tracker.kind, childId, data, time), title, body };
    return flow.save(baby ? `${label}, for ${baby}` : label, () => logCare(b, record), { recordId: record.id, at: record.occurred_at, ...(body ? {} : { follow: "note" as const }) });
  }
  const saveForm = (form: LogForm, label: (data: Record<string, any>) => string) => {
    const data = dataFrom(id, form);
    return void log(data, logTitle(id, form), label(data as Record<string, any>));
  };
  const start = startForm(id, rows, childId), last = lastLog(rows, id, childId);
  return <>
    {behind && <OnThisPhone />}
    {id === "pumping" ? <PumpPanel start={pumpStart(rows, childId)} detail={who} panelProps={panelProps} onSave={(side, amount) =>
      void log({ side, amount: amount.amount, unit: amount.unit }, "Pumping", `Pumping, ${sideWords[side]}, ${amount.amount} ${amount.unit === "oz" ? "oz" : "mL"}`)} />
    : id === "note" ? <NotePanel detail={who} panelProps={panelProps} onSave={(text) => void log({ label: noteLabel }, noteLabel, noteLabel, text)} />
    : id === "feeling" ? <Panel title={tracker.label} {...panelProps}>
      <Choices>{feelingWords.map((word) => <Option key={word} height={64} wraps label={word} onPress={() => void log(dataFrom(id, { ...start, name: word }), word, word)} />)}</Choices>
    </Panel>
    : id === "medicine" ? <FormPanel id={id} title={tracker.label} detail={who} start={start} panelProps={panelProps} autoFocus={!recentMedicines(rows, childId).length} saveAs={(form) => saveForm(form, (data) => data.name)}
      hint={(form) => { const typed = lastDose(rows, childId, form.name); return typed && [typed.dose, lastWords(typed.at)].filter(Boolean).join(" · "); }}
      // Never one tap: half asleep, a tap could be a second dose. It fills the form, with the Last under it, and Save records it.
      offers={(form, fill) => !!recentMedicines(rows, childId).length && <Choices>{recentMedicines(rows, childId).map((one) => <Option key={one.name.toLowerCase()} height={64} label={one.name} detail={[one.dose, lastWords(one.at)].filter(Boolean).join(" · ")}
        strong={form.name.trim().toLowerCase() === one.name.trim().toLowerCase()} onPress={() => fill({ name: one.name, dose: one.dose })} />)}</Choices>} />
    : id === "vitamins" ? <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus={!recentVitamins(rows, childId).length} saveAs={(form) => saveForm(form, () => form.name.trim())}
      // It can hold a medicine too, so like Medicine a tap fills the form and only Save records it.
      offers={(form, fill) => !!recentVitamins(rows, childId).length && <Choices>{recentVitamins(rows, childId).map((one) => <Option key={one.name} height={64} label={one.name} detail={lastWords(one.at)}
        strong={form.name.trim().toLowerCase() === one.name.trim().toLowerCase()} onPress={() => fill({ name: one.name })} />)}</Choices>} />
    : id === "custom" ? <FormPanel id={id} title={tracker.label} detail={who} start={start} panelProps={panelProps} autoFocus={!recentCustomLabels(rows, childId).length} saveAs={(form) => saveForm(form, (data) => data.label)}>
      {!!recentCustomLabels(rows, childId).length && <Choices>{recentCustomLabels(rows, childId).map((label) => <Option key={label} height={64} label={label} onPress={() => void log({ label }, label, label)} />)}</Choices>}
    </FormPanel>
    : id === "temperature" ? <FormPanel id={id} title={tracker.label} detail={who} start={start} panelProps={panelProps} autoFocus saveAs={(form) => saveForm(form, (data) => `${data.value} °${data.unit === "c" ? "C" : "F"}`)} />
    : id === "my_weight" ? <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus saveAs={(form) => saveForm(form, (data) => `${data.value} ${data.unit}`)} />
    : id === "blood_pressure" ? <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus saveAs={(form) => saveForm(form, () => logTitle(id, form))} />
    : <FormPanel id={id} title={tracker.label} detail={[who, last && `Last: ${friendlyTime(last.occurred_at, now, timeZone)}`].filter(Boolean).join(" · ") || undefined} start={start} panelProps={panelProps} saveAs={(form) => saveForm(form, () => tracker.label)} />}
  </>;
}
