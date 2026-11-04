import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { careWrite, logCare, pumpStart, type BottleChoice } from "@/lib/quick-care";
import { friendlyTime } from "@/lib/care-format";
import { dataFrom, feelingWords, lastLog, logTitle, moreKinds, noteLabel, recentCustomLabels, recentMedicines, recentVitamins, startForm, type LogForm } from "@/lib/more-logs";
import type { Tracker } from "@/lib/trackers";
import { messageFor, type Child, type RecordData } from "@/lib/models";
import { useTodayCare } from "@/lib/today-care";
import { Button, Field, OnSurface, typeScale, useColors } from "./ui";
import { LogFields, sideWords } from "./log-fields";
import { AmountStepper, Option, Panel, SavedRow, type useLogFlow } from "./quick-log";
import type { PastDay } from "./quick-time";

type Flow = ReturnType<typeof useLogFlow<string>>;
type PanelProps = Omit<React.ComponentProps<typeof Panel>, "title" | "detail" | "children">;

/** What just saved, with Undo, wherever the panel was opened from. */
export function SavedLog({ flow, now, day, timeZone }: { flow: Flow; now: Date; day?: PastDay; timeZone?: string | null }) {
  const { saved, setSaved, panel, amend, undo } = flow;
  return saved ? <SavedRow key={saved.key} saved={saved} compact={!!panel} now={now} day={day} timeZone={timeZone} onUndo={() => void undo()}
    onGone={() => setSaved((current) => (current?.key === saved.key ? null : current))}
    onMove={(iso) => { const moved = iso ?? new Date().toISOString(); setSaved({ ...saved, at: moved }); amend(() => ({ occurred_at: moved })); }}
    onColor={() => undefined} onNote={(body) => amend((row) => (row.body === body ? {} : { body }))} /> : null;
}

/** Fields and a Save, for what can't be one tap. A wrong entry is said here and nothing is queued. */
function FormPanel({ id, title, detail, start, panelProps, autoFocus, children, saveAs }: { id: string; title: string; detail?: string; start: LogForm; autoFocus?: boolean; children?: React.ReactNode;
  panelProps: PanelProps; saveAs: (form: LogForm) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [form, setForm] = useState(start), [problem, setProblem] = useState("");
  return <Panel title={title} detail={detail} {...panelProps}>
    {children}
    <OnSurface><LogFields id={id} start={start} autoFocus={autoFocus} onChange={(next) => { setForm(next); setProblem(""); }} /></OnSurface>
    {!!problem && <Text accessibilityLiveRegion="polite" key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText }}>{problem}</Text>}
    <Button size="lg" icon="checkmark" title="Save" accessibilityLabel={`Save ${title.toLowerCase()}`} onPress={() => { try { saveAs(form); } catch (e) { setProblem(messageFor(e)); } }} />
  </Panel>;
}

/** The amount from last time, and a side. Choosing a side saves it. */
function PumpPanel({ start, panelProps, onSave }: { start: BottleChoice; panelProps: PanelProps; onSave: (side: keyof typeof sideWords, amount: Pick<BottleChoice, "amount" | "unit">) => void }) {
  const [amount, setAmount] = useState({ amount: start.amount, unit: start.unit }),
    same = start.fromLast && amount.amount === start.amount && amount.unit === start.unit;
  return <Panel title="Pumping" {...panelProps}>
    <AmountStepper amount={amount} onChange={setAmount} note={same ? "Same as last time" : undefined} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(["left", "right", "both"] as const).map((side) => <Option key={side} height={64} label={sideWords[side]} onPress={() => onSave(side, amount)} />)}
    </View>
  </Panel>;
}

function NotePanel({ panelProps, onSave }: { panelProps: PanelProps; onSave: (text: string) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [note, setNote] = useState(""), [empty, setEmpty] = useState(false);
  return <Panel title="Note" {...panelProps}>
    <OnSurface><Field multiline label="What to remember" value={note} autoFocus onChange={(text) => { setNote(text); setEmpty(false); }} /></OnSurface>
    {empty && <Text accessibilityLiveRegion="polite" key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText }}>Write the note first.</Text>}
    <Button size="lg" icon="checkmark" title="Save" accessibilityLabel="Save note" onPress={() => { const text = note.trim(); setEmpty(!text); if (text) onSave(text); }} />
  </Panel>;
}

const Choices = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;

/**
 * One tracker's quick panel, as quick as a diaper: the time defaults to now, nothing goes back anywhere, and it works
 * offline. It only needs a `useLogFlow`, so it opens the same from Today, Tracker or Add. Show `SavedLog` beside it for Undo.
 */
export function TrackerPanel({ tracker, child, now, pastDay, flow }: { tracker: Tracker; child: Child; now: Date; pastDay?: PastDay; flow: Flow }) {
  const b = useBaby(), timeZone = b.state.bootstrap!.profile.timezone, id = tracker.id,
    // What she logs about herself has no baby on it, and stays with her.
    childId = tracker.about === "her" ? null : child.id,
    rows = useTodayCare({ kinds: moreKinds, poll: false, child: child.id }).all,
    panelProps = { at: flow.at, now, day: pastDay, timeZone, needTime: flow.needTime, onTime: flow.change };
  function log(data: RecordData, title: string, label: string, body = "") {
    const time = flow.when();
    if (!time) return;
    const record = { ...careWrite(tracker.kind, childId, data, time), title, body };
    return flow.save(label, () => logCare(b, record), { recordId: record.id, at: record.occurred_at, ...(body ? {} : { follow: "note" as const }) });
  }
  const saveForm = (form: LogForm, label: (data: Record<string, any>) => string) => {
    const data = dataFrom(id, form);
    return void log(data, logTitle(id, form), label(data as Record<string, any>));
  };
  const start = startForm(id, rows, childId), last = lastLog(rows, id, childId);
  if (id === "pumping") return <PumpPanel start={pumpStart(rows, childId)} panelProps={panelProps} onSave={(side, amount) =>
    void log({ side, amount: amount.amount, unit: amount.unit }, "Pumping", `Pumping, ${sideWords[side]}, ${amount.amount} ${amount.unit === "oz" ? "oz" : "mL"}`)} />;
  if (id === "note") return <NotePanel panelProps={panelProps} onSave={(text) => void log({ label: noteLabel }, noteLabel, noteLabel, text)} />;
  if (id === "feeling") return <Panel title={tracker.label} {...panelProps}>
    <Choices>{feelingWords.map((word) => <Option key={word} height={64} label={word} onPress={() => void log(dataFrom(id, { ...start, name: word }), word, word)} />)}</Choices>
  </Panel>;
  if (id === "medicine") {
    const recent = recentMedicines(rows, childId);
    return <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus={!recent.length} saveAs={(form) => saveForm(form, (data) => data.name)}>
      {!!recent.length && <Choices>{recent.map((one) => <Option key={`${one.name}|${one.dose}`} height={64} label={one.name} detail={[one.dose, `Last ${friendlyTime(one.at, now, timeZone)}`].filter(Boolean).join(" · ")}
        onPress={() => void log({ name: one.name, ...(one.dose ? { dose: one.dose } : {}) } as unknown as RecordData, one.name, one.name)} />)}</Choices>}
    </FormPanel>;
  }
  if (id === "vitamins") {
    const recent = recentVitamins(rows, childId);
    return <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus={!recent.length} saveAs={(form) => saveForm(form, () => form.name.trim())}>
      {!!recent.length && <Choices>{recent.map((one) => <Option key={one.name} height={64} label={one.name} detail={`Last ${friendlyTime(one.at, now, timeZone)}`}
        onPress={() => void log(dataFrom(id, { ...start, name: one.name }), one.name, one.name)} />)}</Choices>}
    </FormPanel>;
  }
  if (id === "custom") {
    const labels = recentCustomLabels(rows, childId);
    return <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus={!labels.length} saveAs={(form) => saveForm(form, (data) => data.label)}>
      {!!labels.length && <Choices>{labels.map((label) => <Option key={label} height={64} label={label} onPress={() => void log({ label }, label, label)} />)}</Choices>}
    </FormPanel>;
  }
  if (id === "temperature") return <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus saveAs={(form) => saveForm(form, (data) => `${data.value} °${data.unit === "c" ? "C" : "F"}`)} />;
  if (id === "my_weight") return <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus saveAs={(form) => saveForm(form, (data) => `${data.value} ${data.unit}`)} />;
  if (id === "blood_pressure") return <FormPanel id={id} title={tracker.label} start={start} panelProps={panelProps} autoFocus saveAs={(form) => saveForm(form, () => logTitle(id, form))} />;
  return <FormPanel id={id} title={tracker.label} detail={last ? `Last: ${friendlyTime(last.occurred_at, now, timeZone)}` : undefined} start={start} panelProps={panelProps} saveAs={(form) => saveForm(form, () => tracker.label)} />;
}
