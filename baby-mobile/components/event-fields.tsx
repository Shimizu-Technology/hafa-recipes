import { View } from "react-native";
import { useBaby } from "@/lib/context";
import { allDayChanged, dayName, eventCategories, quickEvent, quickEvents, repeatName, startingAt } from "@/lib/events";
import type { EditorDraft, EventCategory, EventRecurrence } from "@/lib/models";
import { recordDay, zonedInstant } from "@/lib/tracker";
import { DateField } from "./date-field";
import { Chips, Choice, Copy, Field, Notice, useColors } from "./ui";

const frequencies: EventRecurrence["frequency"][] = ["daily", "weekly", "monthly", "yearly"];

/** The form for one event. Choosing a kind, a day and Save is enough. Everything else is there, and already set to something sensible. */
export function EventFields({ draft, change, today, quick = true }: { draft: EditorDraft; change: (value: Partial<EditorDraft>) => void; today: string; quick?: boolean }) {
  const b = useBaby(), c = useColors(), { data } = draft, zone = data.timezone, children = b.state.bootstrap!.children, scope = draft.event_edit?.scope, one = scope === "one",
    key = recordDay(draft.occurred_at, zone), rule = data.recurrence, set = (value: Partial<EditorDraft["data"]>) => change({ data: { ...data, ...value } }),
    // A repeat every two weeks stays as it is until she picks something else.
    repeats = frequencies.map((frequency) => ({ label: repeatName(rule?.frequency === frequency ? rule : { frequency }), value: frequency }));
  return <>
    {scope && <Notice>{one ? `This changes ${dayName(key, today)} only. The other dates stay as they are.` : `This changes ${dayName(key, today)} and every date after it. Earlier dates stay as they are.`}</Notice>}
    {!draft.existing && quick && <Copy kind="small">What’s it for?</Copy>}
    {!draft.existing && quick && <Chips label="What’s it for?" value={quickEvents.some((item) => item.title === draft.title) ? draft.title : ""}
      options={quickEvents.map(({ title }) => ({ label: title, value: title }))} onChange={(title) => change(quickEvent(draft, title))} />}
    <Field label="Name" value={draft.title} maxLength={240} onChange={(title) => change({ title })} placeholder="Baptism, doctor visit, family dinner…" />
    {data.all_day
      ? <DateField label="Date" dateOnly value={key} onChange={(day) => change({ occurred_at: zonedInstant(day, 0, 0, zone).toISOString() })} />
      : <DateField label="Date and time" timeZone={zone} value={draft.occurred_at} onChange={(start) => change(startingAt(draft, start))} />}
    <Choice label="All day" selected={!!data.all_day} onPress={() => change(allDayChanged(draft, !data.all_day))} />
    {!one && <Copy kind="small">Repeat</Copy>}
    {!one && <Chips label="Repeat" value={rule?.frequency ?? ""} options={[{ label: "Doesn’t repeat", value: "" }, ...repeats]}
      onChange={(frequency) => set({ recurrence: frequency ? { ...rule, interval: rule?.frequency === frequency ? rule.interval : 1, frequency: frequency as EventRecurrence["frequency"] } : null })} />}
    {!one && rule && <DateField label="Repeat until (optional)" dateOnly optional value={rule.until} onChange={(until) => set({ recurrence: { ...rule, until: until || null } })} />}
    <Copy kind="small">Category</Copy>
    <Chips label="Category" value={data.category ?? "other"} options={eventCategories.map(({ value, label }) => ({ value, label, dot: c.categories?.[value] }))}
      onChange={(category) => set({ category: category as EventCategory })} />
    <Field label="Location (optional)" value={data.location ?? ""} maxLength={240} onChange={(location) => set({ location })} placeholder="Clinic, church, grandma’s house…" />
    {!one && children.length > 0 && <Copy kind="small">Who is it for?</Copy>}
    {!one && children.length > 0 && <Chips label="Who is it for?" value={draft.child_id ?? ""}
      options={[{ label: "Whole family", value: "" }, ...children.map((child) => ({ label: child.name, value: child.id }))]} onChange={(id) => change({ child_id: id || null })} />}
    {!one && <Field label="Note (optional)" multiline value={draft.body} onChange={(body) => change({ body })} placeholder="Anything to remember about it" />}
  </>;
}
